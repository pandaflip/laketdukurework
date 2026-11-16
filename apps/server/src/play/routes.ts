import { CLOSE_CODES, SUPPORTED_LOCALES, type ServerMessage } from '@app/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RawData, WebSocket } from 'ws';
import { z } from 'zod';
import type { AppConfig } from '../config';
import { AppError, notFound, parse } from '../errors';
import { formatIdentity, normalizeRoomCode, parseIdentity } from './codes';
import type { RoomManager } from './manager';
import type { Connection, Room } from './room';

/** The identity cookie of one room. Its path is that room only, so two rooms never mix. */
const COOKIE = 'play';
const COOKIE_MAX_AGE_SECONDS = 6 * 60 * 60;
const HEARTBEAT_MS = 20_000;
export const MAX_MESSAGE_BYTES = 2_048;
const TOKEN_PATTERN = /^[a-f0-9]{32}$/;

const joinBody = z.strictObject({
  nickname: z.string().max(64),
  locale: z.enum(SUPPORTED_LOCALES).default('en'),
});

const forbiddenOrigin = (): AppError => new AppError(403, 'FORBIDDEN_ORIGIN');
const unauthenticated = (): AppError => new AppError(401, 'UNAUTHENTICATED');
const roomNotFound = (): AppError => new AppError(404, 'ROOM_NOT_FOUND');

/** A WebSocket as a `Connection`: a slow client is cut off instead of being waited for. */
export class SocketConnection implements Connection {
  constructor(
    private readonly socket: WebSocket,
    private readonly maxBuffered: number,
  ) {}

  send(message: ServerMessage): boolean {
    if (this.socket.readyState !== this.socket.OPEN) return false;
    if (this.socket.bufferedAmount > this.maxBuffered) {
      this.close(CLOSE_CODES.tryAgainLater);
      return false;
    }
    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  close(code: number): void {
    try {
      this.socket.close(code);
    } catch {
      this.socket.terminate();
    }
    // A client that does not answer the closing handshake is dropped.
    const timer = setTimeout(() => {
      if (this.socket.readyState !== this.socket.CLOSED) this.socket.terminate();
    }, 2_000);
    timer.unref();
  }
}

export interface PlayRoutesOptions {
  readonly manager: RoomManager;
  readonly config: AppConfig;
}

export function registerPlayRoutes(
  app: FastifyInstance,
  { manager, config }: PlayRoutesOptions,
): void {
  /** State-changing requests must come from the web app itself. */
  const requireOrigin = (request: FastifyRequest): void => {
    if (request.headers.origin !== config.WEB_ORIGIN) throw forbiddenOrigin();
  };

  const roomOf = (request: FastifyRequest): Room => {
    const params = request.params as { code?: string };
    const code = normalizeRoomCode(params.code ?? '');
    const room = code === null ? undefined : manager.find(code);
    if (!room) throw roomNotFound();
    return room;
  };

  /** The player this request speaks for: the identity cookie of THIS room, and nothing else. */
  const playerOf = (request: FastifyRequest, room: Room): string | null => {
    const identity = parseIdentity(request.cookies[COOKIE]);
    return identity && room.authenticate(identity.playerId, identity.secret)
      ? identity.playerId
      : null;
  };

  const setIdentity = (
    reply: { setCookie: (name: string, value: string, options: object) => unknown },
    room: Room,
    playerId: string,
    secret: string,
  ): void => {
    reply.setCookie(COOKIE, formatIdentity(playerId, secret), {
      path: `/api/play/rooms/${room.code}`,
      httpOnly: true,
      sameSite: 'strict',
      secure: config.NODE_ENV === 'production',
      maxAge: COOKIE_MAX_AGE_SECONDS,
    });
  };

  app.post(
    '/rooms',
    { config: { rateLimit: { max: config.PLAY_CREATE_RATE_PER_MINUTE, timeWindow: '1 minute' } } },
    (request, reply) => {
      requireOrigin(request);
      const body = parse(joinBody, request.body);
      const created = manager.create(request.ip, body.nickname, body.locale);
      if (!created.ok) {
        throw created.reason === 'BAD_NICKNAME'
          ? new AppError(400, 'BAD_NICKNAME')
          : new AppError(429, 'TOO_MANY_ROOMS');
      }
      setIdentity(reply, created.room, created.playerId, created.secret);
      return { code: created.room.code, playerId: created.playerId };
    },
  );

  app.post(
    '/rooms/:code/join',
    { config: { rateLimit: { max: config.PLAY_JOIN_RATE_PER_MINUTE, timeWindow: '1 minute' } } },
    (request, reply) => {
      requireOrigin(request);
      const room = roomOf(request);
      // Someone who already belongs to the room comes back as themselves.
      const existing = playerOf(request, room);
      if (existing !== null) return { code: room.code, playerId: existing };

      const body = parse(joinBody, request.body);
      const joined = room.join(body.nickname, body.locale);
      if (!joined.ok) {
        const failures = {
          FULL: new AppError(409, 'ROOM_FULL'),
          STARTED: new AppError(409, 'ROOM_STARTED'),
          BAD_NICKNAME: new AppError(400, 'BAD_NICKNAME'),
          NICKNAME_TAKEN: new AppError(409, 'NICKNAME_TAKEN'),
        } as const;
        throw failures[joined.reason];
      }
      setIdentity(reply, room, joined.playerId, joined.secret);
      return { code: room.code, playerId: joined.playerId };
    },
  );

  app.get(
    '/rooms/:code',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    (request) => {
      const { phase, players, capacity, joinable } = roomOf(request).info();
      return { phase, players, capacity, joinable };
    },
  );

  /**
   * One step of the picture on screen. The address is the same for the whole
   * room, so it proves nothing by itself: the request must come from a member
   * of THIS room (identity cookie), and the step must have been revealed in
   * the round in progress. Every refusal is the same 404.
   */
  app.get(
    '/rooms/:code/frames/:token',
    { config: { rateLimit: { max: 1_500, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const params = request.params as { token?: string };
      const room = roomOf(request);
      const playerId = playerOf(request, room);
      if (playerId === null || !TOKEN_PATTERN.test(params.token ?? '')) throw notFound();
      const frame = await room.match.openFrame(params.token ?? '', playerId);
      if (!frame) throw notFound();
      return reply
        .header('Content-Type', frame.contentType)
        .header('Cache-Control', 'private, max-age=300')
        .header('Vary', 'Cookie')
        .header('Cross-Origin-Resource-Policy', 'same-site')
        .send(frame.bytes);
    },
  );

  app.get(
    '/rooms/:code/ws',
    {
      websocket: true,
      config: { rateLimit: { max: config.PLAY_CONNECT_RATE_PER_MINUTE, timeWindow: '1 minute' } },
      // Refused with a plain HTTP error BEFORE the connection is upgraded.
      preValidation: (request, _reply, done) => {
        try {
          if (request.headers.origin !== config.WEB_ORIGIN) throw forbiddenOrigin();
          if (playerOf(request, roomOf(request)) === null) throw unauthenticated();
          done();
        } catch (error) {
          done(error as Error);
        }
      },
    },
    (socket: WebSocket, request) => {
      const room = roomOf(request);
      const playerId = playerOf(request, room);
      if (playerId === null) {
        socket.close(CLOSE_CODES.policy);
        return;
      }
      const connection = new SocketConnection(socket, config.WS_MAX_BUFFERED_BYTES);

      let alive = true;
      const heartbeat = setInterval(() => {
        if (!alive) {
          socket.terminate();
          return;
        }
        alive = false;
        socket.ping();
      }, HEARTBEAT_MS);
      heartbeat.unref();
      socket.on('pong', () => {
        alive = true;
      });
      socket.on('message', (data: RawData, isBinary: boolean) => {
        if (isBinary) {
          connection.send({ type: 'error', code: 'UNSUPPORTED' });
          return;
        }
        const text = Array.isArray(data)
          ? Buffer.concat(data).toString('utf8')
          : Buffer.from(data as Buffer).toString('utf8');
        room.receive(playerId, connection, text);
      });
      socket.on('close', () => {
        clearInterval(heartbeat);
        room.detach(playerId, connection);
      });
      socket.on('error', () => {
        socket.terminate();
      });

      room.attach(playerId, connection);
    },
  );
}
