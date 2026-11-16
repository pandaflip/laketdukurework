import {
  createRng,
  MAX_PLAYERS,
  REVEAL_MS,
  type CharacterDto,
  type UniverseDto,
} from '@app/shared';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SocketConnection } from '../src/play/routes';
import { importPicture, saveSequenceOf } from './image-helpers';
import {
  adminClient,
  createReviewedUniverse,
  startApp,
  WEB_ORIGIN,
  type Client,
  type TestContext,
} from './helpers';
import { ManualTimers, PlayClient, Refused, sleep } from './play-helpers';

const NAMES = ['Ahri', 'Zed', 'Karma', 'Sona', 'Nami', 'Lux'];

interface Harness {
  readonly context: TestContext;
  readonly timers: ManualTimers;
  readonly http: string;
  readonly ws: string;
}

/** An app that really listens, over a populated catalog, with a hand-moved game clock. */
async function boot(env: Record<string, string> = {}): Promise<Harness> {
  const timers = new ManualTimers();
  const context = await startApp(
    { playTimers: timers, playRandom: createRng(3), rateLimitMax: 1_000_000 },
    {
      MAX_ROOMS: '200',
      MAX_ROOMS_PER_IP: '200',
      PLAY_CREATE_RATE_PER_MINUTE: '10000',
      PLAY_JOIN_RATE_PER_MINUTE: '10000',
      PLAY_CONNECT_RATE_PER_MINUTE: '10000',
      ...env,
    },
  );
  await context.app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = context.app.server.address() as AddressInfo;
  return { context, timers, http: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}` };
}

async function populate(context: TestContext): Promise<void> {
  const admin: Client = await adminClient(context);
  const universe: UniverseDto = await createReviewedUniverse(admin, 'League of Legends');
  let seed = 0;
  for (const name of NAMES) {
    const created = await admin.post('/characters', {
      universeId: universe.id,
      names: { en: name },
    });
    const character = created.json<CharacterDto>();
    seed += 1;
    const image = await importPicture(admin, character.id, { seed });
    await saveSequenceOf(admin, image, 6);
    const reviewed = await admin.put(`/images/${image.id}/review`, { review: 'APPROVED_NEUTRAL' });
    expect(reviewed.statusCode, reviewed.body).toBe(200);
  }
}

interface Session {
  readonly code: string;
  readonly playerId: string;
  readonly cookie: string;
}

class Api {
  constructor(private readonly h: Harness) {}

  async call(
    method: 'GET' | 'POST',
    path: string,
    options: { body?: unknown; origin?: string | null; cookie?: string } = {},
  ): Promise<{
    status: number;
    json: Record<string, unknown>;
    cookie: string | null;
    res: Response;
  }> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const origin = options.origin === undefined ? WEB_ORIGIN : options.origin;
    if (origin !== null) headers.origin = origin;
    if (options.cookie !== undefined) headers.cookie = options.cookie;
    const res = await fetch(`${this.h.http}${path}`, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const setCookie = res.headers.getSetCookie()[0];
    const type = res.headers.get('content-type') ?? '';
    const json = type.includes('json') ? ((await res.json()) as Record<string, unknown>) : {};
    if (!type.includes('json')) await res.arrayBuffer();
    return { status: res.status, json, cookie: setCookie?.split(';')[0] ?? null, res };
  }

  async create(nickname: string, locale = 'en'): Promise<Session> {
    const result = await this.call('POST', '/api/play/rooms', { body: { nickname, locale } });
    expect(result.status, JSON.stringify(result.json)).toBe(200);
    return {
      code: String(result.json.code),
      playerId: String(result.json.playerId),
      cookie: result.cookie ?? '',
    };
  }

  async join(code: string, nickname: string): Promise<Session> {
    const result = await this.call('POST', `/api/play/rooms/${code}/join`, {
      body: { nickname, locale: 'en' },
    });
    expect(result.status, JSON.stringify(result.json)).toBe(200);
    return { code, playerId: String(result.json.playerId), cookie: result.cookie ?? '' };
  }

  connect(
    session: Session,
    options: { origin?: string | null; cookie?: string; code?: string } = {},
  ) {
    const headers: Record<string, string> = { Cookie: options.cookie ?? session.cookie };
    const origin = options.origin === undefined ? WEB_ORIGIN : options.origin;
    if (origin !== null) headers.Origin = origin;
    return PlayClient.open(
      `${this.h.ws}/api/play/rooms/${options.code ?? session.code}/ws`,
      headers,
    );
  }

  async frame(code: string, token: string, cookie: string | null) {
    return this.call('GET', `/api/play/rooms/${code}/frames/${token}`, {
      ...(cookie === null ? {} : { cookie }),
    });
  }
}

async function until(condition: () => boolean, timeoutMs = 8_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for a condition');
    await sleep(10);
  }
}

async function command(client: PlayClient, message: Record<string, unknown>) {
  const before = client.of('commandResult').length;
  client.send(message);
  await until(() => client.of('commandResult').length > before);
  return client.of('commandResult')[before];
}

/** Everyone in `players` connects; the first one is the host. */
async function startRoom(
  api: Api,
  h: Harness,
  count: number,
  config: Record<string, unknown> = {},
): Promise<{ code: string; sessions: Session[]; clients: PlayClient[] }> {
  const host = await api.create('Host');
  const sessions = [host];
  for (let index = 1; index < count; index++) {
    sessions.push(await api.join(host.code, `Guest ${index}`));
  }
  const clients = await Promise.all(sessions.map((session) => api.connect(session)));
  await Promise.all(clients.map((client) => client.waitFor((m) => m.type === 'state')));
  const hostClient = clients[0] as PlayClient;
  expect(
    await command(hostClient, {
      type: 'configure',
      config: { steps: 3, stepDelaySec: 15, targetScore: 1000, ...config },
    }),
  ).toMatchObject({ ok: true });
  const pool = await hostClient.waitFor((m) => m.type === 'pool');
  expect(pool).toMatchObject({ size: NAMES.length });
  expect(await command(hostClient, { type: 'start' })).toMatchObject({ ok: true });
  await Promise.all(
    clients.map((client) =>
      client.waitFor((m) => m.type === 'state' && m.public.phase === 'countdown'),
    ),
  );
  await h.timers.advance(3_000);
  await Promise.all(
    clients.map((client) =>
      client.waitFor((m) => m.type === 'state' && m.public.phase === 'round'),
    ),
  );
  return { code: host.code, sessions, clients };
}

/** Finds the answer by trying every suggested name, spacing the attempts by the cooldown. */
async function solve(client: PlayClient, h: Harness): Promise<string> {
  const welcome = client.of('welcome')[0];
  for (const name of welcome?.suggestions ?? []) {
    const stepIndex = client.state()?.public.round?.stepIndex ?? 0;
    const before = client.of('answerResult').length;
    client.send({ type: 'answer', stepIndex, text: name });
    await until(() => client.of('answerResult').length > before);
    const result = client.of('answerResult')[before]?.result;
    if (result?.status === 'correct') return name;
    await h.timers.advance(2_100);
  }
  throw new Error('no suggestion was right');
}

let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await boot();
  await populate(h.context);
  api = new Api(h);
}, 120_000);
afterAll(async () => {
  await h.context.close();
});

describe('creating and joining a room', () => {
  it('gives a code and an identity cookie limited to that room', async () => {
    const result = await api.call('POST', '/api/play/rooms', {
      body: { nickname: 'Alice', locale: 'fr' },
    });
    expect(result.status).toBe(200);
    expect(String(result.json.code)).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    const header = result.res.headers.getSetCookie()[0] ?? '';
    expect(header).toContain(`Path=/api/play/rooms/${String(result.json.code)}`);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Strict');
    expect(header).not.toContain('Secure'); // only in production
    expect(JSON.stringify(result.json)).not.toMatch(/secret/i);
  });

  it('refuses a request that does not come from the web app', async () => {
    for (const origin of ['https://evil.example', null]) {
      const refused = await api.call('POST', '/api/play/rooms', {
        origin,
        body: { nickname: 'Mallory' },
      });
      expect(refused.status).toBe(403);
      expect(refused.json).toEqual({ error: { code: 'FORBIDDEN_ORIGIN' } });
    }
  });

  it('validates nicknames, refuses duplicates, full rooms and started games', async () => {
    const host = await api.create('Host');
    const join = (nickname: string) =>
      api.call('POST', `/api/play/rooms/${host.code.toLowerCase()}/join`, {
        body: { nickname },
      });
    expect((await join('x')).json).toEqual({ error: { code: 'BAD_NICKNAME' } });
    expect((await join('host')).status).toBe(409);
    expect((await join('host')).json).toEqual({ error: { code: 'NICKNAME_TAKEN' } });
    for (let index = 1; index < MAX_PLAYERS; index++)
      expect((await join(`Guest ${index}`)).status).toBe(200);
    expect((await join('One too many')).json).toEqual({ error: { code: 'ROOM_FULL' } });
    expect((await api.call('GET', `/api/play/rooms/${host.code}`)).json).toMatchObject({
      players: MAX_PLAYERS,
      joinable: false,
    });
  });

  it('answers the same way for a room that never existed, whatever its shape', async () => {
    for (const code of ['ZZZZZZ', 'abc', '../admin', 'AAAAAA%00']) {
      const result = await api.call('GET', `/api/play/rooms/${encodeURIComponent(code)}`);
      expect(result.status).toBe(404);
      expect(result.json).toEqual({ error: { code: 'ROOM_NOT_FOUND' } });
    }
  });

  it('lets someone who belongs to the room come back as themselves', async () => {
    const host = await api.create('Host');
    const again = await api.call('POST', `/api/play/rooms/${host.code}/join`, {
      cookie: host.cookie,
      body: { nickname: 'Somebody else' },
    });
    expect(again.json.playerId).toBe(host.playerId);
    expect(again.cookie).toBeNull();
  });

  it('refuses joining once the game has started', async () => {
    const room = await startRoom(api, h, 2);
    const late = await api.call('POST', `/api/play/rooms/${room.code}/join`, {
      body: { nickname: 'Latecomer' },
    });
    expect(late.json).toEqual({ error: { code: 'ROOM_STARTED' } });
    room.clients.forEach((client) => {
      client.close();
    });
  }, 30_000);
});

describe('who may open a connection', () => {
  it('refuses a missing, forged or foreign identity before the upgrade', async () => {
    const one = await api.create('Alice');
    const two = await api.create('Bob');
    const secretOfOne = one.cookie.split('.')[1] ?? '';
    const forged = [
      '',
      'play=garbage',
      `play=${one.playerId}.${'0'.repeat(64)}`, // right player, wrong secret
      `play=${'a'.repeat(32)}.${secretOfOne}`, // right secret, other player
      two.cookie, // a valid identity... of another room
    ];
    for (const cookie of forged) {
      await expect(api.connect(one, { cookie })).rejects.toMatchObject({ status: 401 });
    }
    await expect(api.connect(one, { origin: 'https://evil.example' })).rejects.toMatchObject({
      status: 403,
    });
    await expect(api.connect(one, { origin: null })).rejects.toMatchObject({ status: 403 });
    await expect(api.connect(one, { code: 'ZZZZZZ' })).rejects.toMatchObject({ status: 404 });
    await expect(api.connect(one, { code: 'nope' })).rejects.toBeInstanceOf(Refused);
  });

  it('greets a valid player with their identity and the names they may type', async () => {
    const session = await api.create('Alice', 'fr');
    const client = await api.connect(session);
    const welcome = await client.waitFor((m) => m.type === 'welcome');
    await client.waitFor((m) => m.type === 'state');
    // The welcome always comes first: state messages never precede it.
    expect(client.messages[0]?.type).toBe('welcome');
    expect(welcome).toMatchObject({ roomCode: session.code, playerId: session.playerId });
    expect(welcome.type === 'welcome' && welcome.suggestions).toEqual([...NAMES].sort());
    const state = await client.waitFor((m) => m.type === 'state');
    expect(state.type === 'state' && state.private.playerId).toBe(session.playerId);
    expect(JSON.stringify(welcome)).not.toMatch(/secret|cookie/i);
    client.close();
  });

  it('lets a second tab of the same browser replace the first, as the same player', async () => {
    const session = await api.create('Alice');
    const first = await api.connect(session);
    await first.waitFor((m) => m.type === 'state');
    const second = await api.connect(session);
    await second.waitFor((m) => m.type === 'state');
    expect(await first.waitClosed()).toBe(4001);
    expect(first.of('closing')).toEqual([{ type: 'closing', reason: 'REPLACED' }]);
    expect(second.state()?.private.playerId).toBe(session.playerId);
    expect(second.closeCode).toBeNull();
    second.close();
  });

  it('never lets a connection act as, or for, another player', async () => {
    const host = await api.create('Host');
    const guest = await api.join(host.code, 'Guest');
    const guestClient = await api.connect(guest);
    await guestClient.waitFor((m) => m.type === 'state');
    // Host rights come from the identity, never from the content of a message.
    expect(await command(guestClient, { type: 'configure', config: { steps: 5 } })).toMatchObject({
      ok: false,
      reason: 'NOT_HOST',
    });
    expect(await command(guestClient, { type: 'start' })).toMatchObject({
      ok: false,
      reason: 'NOT_HOST',
    });
    for (const forged of [
      { type: 'start', playerId: host.playerId },
      { type: 'start', isHost: true },
      { type: 'answer', stepIndex: 0, text: 'Ahri', playerId: host.playerId },
      { type: 'vote', stepIndex: 0, score: 9999 },
    ]) {
      const before = guestClient.of('error').length;
      guestClient.send(forged);
      await until(() => guestClient.of('error').length > before);
    }
    expect(guestClient.of('error').every((m) => m.code === 'INVALID_MESSAGE')).toBe(true);
    expect(guestClient.state()?.public.phase).toBe('lobby');
    guestClient.close();
  });
});

describe('abuse and slow clients', () => {
  it('closes a connection that sends oversized messages', async () => {
    const client = await api.connect(await api.create('Alice'));
    await client.waitFor((m) => m.type === 'state');
    client.sendRaw(JSON.stringify({ type: 'answer', stepIndex: 0, text: 'x'.repeat(5_000) }));
    expect(await client.waitClosed()).toBe(1009);
  });

  it('answers invalid messages with an error, then cuts off a persistent offender', async () => {
    const client = await api.connect(await api.create('Alice'));
    await client.waitFor((m) => m.type === 'state');
    client.send('not json at all');
    client.sendRaw(Buffer.from([1, 2, 3]), true);
    await client.waitFor((m) => m.type === 'error' && m.code === 'INVALID_MESSAGE');
    await client.waitFor((m) => m.type === 'error' && m.code === 'UNSUPPORTED');
    for (let index = 0; index < 6; index++) client.send({ type: 'teleport' });
    expect(await client.waitClosed()).toBe(1008);
    expect(client.of('closing').at(-1)).toEqual({ type: 'closing', reason: 'ABUSE' });
  });

  it('slows then cuts off a connection that floods the room', async () => {
    const client = await api.connect(await api.create('Alice'));
    await client.waitFor((m) => m.type === 'state');
    for (let index = 0; index < 80; index++) client.send({ type: 'vote', stepIndex: 0 });
    expect(await client.waitClosed()).toBe(1008);
    expect(client.of('error').some((m) => m.code === 'RATE_LIMITED')).toBe(true);
  });

  it('drops a client that does not read instead of waiting for it', () => {
    const closed: number[] = [];
    const sent: string[] = [];
    const socket = {
      OPEN: 1,
      CLOSED: 3,
      readyState: 1,
      bufferedAmount: 5_000_000,
      send: (text: string) => sent.push(text),
      close: (code: number) => closed.push(code),
      terminate: () => undefined,
    };
    const connection = new SocketConnection(socket as never, 1_000_000);
    expect(connection.send({ type: 'pool', size: 1 })).toBe(false);
    expect(sent).toEqual([]);
    expect(closed).toEqual([1013]);
    socket.bufferedAmount = 0;
    expect(connection.send({ type: 'pool', size: 1 })).toBe(true);
    expect(sent).toHaveLength(1);
  });
});

describe('a game over the network', () => {
  it('plays a whole game: pool, start, frames, answers, reveal, winner', async () => {
    const room = await startRoom(api, h, 2);
    const [host, guest] = room.clients as [PlayClient, PlayClient];
    const [hostSession, guestSession] = room.sessions as [Session, Session];

    // The first step is on screen and its picture can be fetched by the room's members.
    const round = host.state()?.public.round;
    expect(round).toMatchObject({ number: 1, stepIndex: 0, stepCount: 3 });
    const token = round?.frameToken ?? '';
    const picture = await api.frame(room.code, token, hostSession.cookie);
    expect(picture.status).toBe(200);
    expect(picture.res.headers.get('content-type')).toBe('image/webp');
    expect(picture.res.headers.get('cache-control')).toBe('private, max-age=300');

    // Without an identity, or with a made-up address, there is nothing: always the same answer.
    expect((await api.frame(room.code, token, null)).status).toBe(404);
    expect((await api.frame(room.code, 'f'.repeat(32), hostSession.cookie)).status).toBe(404);
    expect((await api.frame(room.code, 'not-a-token', hostSession.cookie)).status).toBe(404);

    const answer = await solve(host, h);
    await guest.waitFor(
      (m) =>
        m.type === 'state' &&
        m.public.players.find((p) => p.id === hostSession.playerId)?.found === true,
    );
    expect(guest.state()?.public.players.find((p) => p.id === hostSession.playerId)).toMatchObject({
      found: true,
      foundRank: 1,
      foundPoints: 1000,
    });
    // The other player has not found it yet: nothing in what they received names the answer.
    const beforeReveal = JSON.stringify(
      [...host.of('state'), ...guest.of('state')].filter((m) =>
        ['awaitingChallenge', 'countdown', 'round'].includes(m.public.phase),
      ),
    );
    expect(beforeReveal.toLowerCase()).not.toContain(answer.toLowerCase());

    guest.send({
      type: 'answer',
      stepIndex: guest.state()?.public.round?.stepIndex ?? 0,
      text: answer,
    });
    const revealed = await guest.waitFor((m) => m.type === 'state' && m.public.phase === 'reveal');
    expect(revealed.type === 'state' && revealed.public.reveal).toMatchObject({
      names: { en: answer },
      finders: [
        { playerId: hostSession.playerId, rank: 1, points: 1000 },
        { playerId: guestSession.playerId, rank: 2, points: 800 },
      ],
    });
    const whole = revealed.type === 'state' ? (revealed.public.reveal?.frameToken ?? '') : '';
    expect((await api.frame(room.code, whole, guestSession.cookie)).status).toBe(200);

    // The host reached the target: the game ends after the reveal, with them as the winner.
    await h.timers.advance(REVEAL_MS);
    const done = await host.waitFor((m) => m.type === 'state' && m.public.phase === 'finished');
    expect(done.type === 'state' && done.public.winners).toEqual([hostSession.playerId]);
    expect((await api.frame(room.code, whole, guestSession.cookie)).status).toBe(404);
    host.close();
    guest.close();
  }, 60_000);

  it('keeps identity, score, attempts and vote across a lost connection', async () => {
    const room = await startRoom(api, h, 3, {
      attempts: { kind: 'limited', max: 3 },
      vote: { enabled: true, threshold: 'unanimous' },
    });
    const [a, b, c] = room.clients as [PlayClient, PlayClient, PlayClient];
    const [sessionA, sessionB] = room.sessions as [Session, Session, Session];

    b.send({ type: 'answer', stepIndex: 0, text: 'Definitely wrong' });
    await b.waitFor((m) => m.type === 'answerResult');
    b.send({ type: 'vote', stepIndex: 0 });
    await b.waitFor((m) => m.type === 'voteResult');
    await until(() => b.state()?.private.voted === true);

    // The connection drops and comes back inside the grace delay: nobody notices.
    b.terminate();
    await sleep(150); // the server notices the closed socket
    await h.timers.advance(2_000);
    const b2 = await api.connect(sessionB);
    await b2.waitFor((m) => m.type === 'state' && m.private.attemptsUsed === 1);
    expect(b2.state()?.private).toMatchObject({
      playerId: sessionB.playerId,
      attemptsUsed: 1,
      attemptsLeft: 2,
      voted: true,
      myWrongAnswers: ['Definitely wrong'],
    });
    await sleep(100);
    expect(a.of('state').every((m) => m.public.players.every((p) => p.connected))).toBe(true);

    // Gone for longer than the grace delay: the others see it, then see them come back.
    c.terminate();
    await sleep(150);
    await h.timers.advance(5_000);
    await a.waitFor(
      (m) =>
        m.type === 'state' &&
        m.public.players.find((p) => p.nickname === 'Guest 2')?.connected === false,
    );
    const c2 = await api.connect(room.sessions[2] as Session);
    await a.waitFor(
      (m) =>
        m.type === 'state' &&
        m.public.players.find((p) => p.nickname === 'Guest 2')?.connected === true,
    );
    expect(c2.state() ?? (await c2.waitFor((m) => m.type === 'state'))).toBeDefined();
    expect(sessionA.playerId).toBe(a.state()?.private.playerId);
    for (const client of [a, b2, c2]) client.close();
  }, 60_000);
});

describe('two rooms never meet', () => {
  it('keeps pictures, commands and updates inside their own room', async () => {
    const one = await startRoom(api, h, 2);
    const two = await startRoom(api, h, 2);
    const [oneHost] = one.clients as [PlayClient, PlayClient];
    const [twoHost, twoGuest] = two.clients as [PlayClient, PlayClient];
    const [oneSession] = one.sessions as [Session, Session];
    const [twoSession] = two.sessions as [Session, Session];

    const tokenOne = oneHost.state()?.public.round?.frameToken ?? '';
    const tokenTwo = twoHost.state()?.public.round?.frameToken ?? '';
    expect((await api.frame(one.code, tokenOne, oneSession.cookie)).status).toBe(200);
    expect((await api.frame(two.code, tokenTwo, twoSession.cookie)).status).toBe(200);

    // A member of one room cannot read the other's pictures, with either address or either identity.
    expect((await api.frame(two.code, tokenOne, twoSession.cookie)).status).toBe(404);
    expect((await api.frame(one.code, tokenTwo, oneSession.cookie)).status).toBe(404);
    expect((await api.frame(one.code, tokenOne, twoSession.cookie)).status).toBe(404);
    expect((await api.frame(two.code, tokenTwo, oneSession.cookie)).status).toBe(404);
    // An identity of one room cannot even open a connection to the other.
    await expect(api.connect(twoSession, { code: one.code })).rejects.toMatchObject({
      status: 401,
    });

    // What happens in one room does not reach the other.
    const seenByTwo = twoGuest.messages.length;
    const answer = await solve(oneHost, h);
    await sleep(150);
    expect(
      twoGuest.messages
        .slice(seenByTwo)
        .map((m) => JSON.stringify(m))
        .join(''),
    ).not.toContain(answer);
    expect(twoHost.state()?.public.players.every((p) => !p.found)).toBe(true);
    expect(twoHost.state()?.public.players.every((p) => p.score === 0)).toBe(true);

    for (const client of [...one.clients, ...two.clients]) client.close();
  }, 90_000);
});

describe('the lobby', () => {
  it('frees the seat of a player who stays away, and lets leaving be immediate', async () => {
    const host = await api.create('Host');
    const stays = await api.join(host.code, 'Stays');
    const leaves = await api.join(host.code, 'Leaves');
    const gone = await api.join(host.code, 'Gone');
    const hostClient = await api.connect(host);
    const staysClient = await api.connect(stays);
    const leavesClient = await api.connect(leaves);
    await hostClient.waitFor((m) => m.type === 'state' && m.public.players.length === 4);

    leavesClient.send({ type: 'leave' });
    expect(await leavesClient.waitClosed()).toBe(1000);
    await hostClient.waitFor((m) => m.type === 'state' && m.public.players.length === 3);

    // "Gone" never connected: after the lobby delay the seat is free again.
    await h.timers.advance(61_000);
    await hostClient.waitFor((m) => m.type === 'state' && m.public.players.length === 2);
    expect((await api.call('GET', `/api/play/rooms/${host.code}`)).json).toMatchObject({
      players: 2,
    });
    await expect(api.connect(gone)).rejects.toMatchObject({ status: 401 });
    for (const client of [hostClient, staysClient]) client.close();
  }, 30_000);
});

describe('limits and cleanup', () => {
  it('caps rooms in total and per address, configurable, and frees them when closed', async () => {
    const small = await boot({ MAX_ROOMS: '3', MAX_ROOMS_PER_IP: '2' });
    try {
      const smallApi = new Api(small);
      const first = await smallApi.create('One');
      await smallApi.create('Two');
      const refused = await smallApi.call('POST', '/api/play/rooms', {
        body: { nickname: 'Three' },
      });
      expect(refused.status).toBe(429);
      expect(refused.json).toEqual({ error: { code: 'TOO_MANY_ROOMS' } });

      // Nobody ever connects: both rooms are empty and are closed by the cleanup.
      await small.timers.advance(3 * 60_000);
      expect((await smallApi.call('GET', `/api/play/rooms/${first.code}`)).status).toBe(404);
      expect(
        (await smallApi.call('POST', '/api/play/rooms', { body: { nickname: 'Four' } })).status,
      ).toBe(200);
    } finally {
      await small.context.close();
    }
  }, 60_000);

  it('limits, per address, how fast rooms are created, joined and connected to', async () => {
    const strict = await boot({
      PLAY_CREATE_RATE_PER_MINUTE: '2',
      PLAY_JOIN_RATE_PER_MINUTE: '2',
      PLAY_CONNECT_RATE_PER_MINUTE: '2',
    });
    try {
      const strictApi = new Api(strict);
      const session = await strictApi.create('One');
      await strictApi.create('Two');
      const created = await strictApi.call('POST', '/api/play/rooms', {
        body: { nickname: 'Three' },
      });
      expect(created.status).toBe(429);
      expect(created.json).toEqual({ error: { code: 'RATE_LIMITED' } });

      const joins = [];
      for (let index = 0; index < 3; index++) {
        joins.push(
          (
            await strictApi.call('POST', `/api/play/rooms/${session.code}/join`, {
              body: { nickname: `Guest ${index}` },
            })
          ).status,
        );
      }
      expect(joins).toEqual([200, 200, 429]);

      await (await strictApi.connect(session)).waitFor((m) => m.type === 'state');
      await (await strictApi.connect(session)).waitFor((m) => m.type === 'state');
      await expect(strictApi.connect(session)).rejects.toMatchObject({ status: 429 });
    } finally {
      await strict.context.close();
    }
  }, 60_000);

  it('closes an idle room and tells whoever is still there', async () => {
    const quiet = await boot({ ROOM_IDLE_MINUTES: '5' });
    try {
      const quietApi = new Api(quiet);
      const session = await quietApi.create('Alice');
      const client = await quietApi.connect(session);
      await client.waitFor((m) => m.type === 'state');
      await quiet.timers.advance(6 * 60_000);
      expect(await client.waitClosed()).toBe(1001);
      expect(client.of('closing').at(-1)).toEqual({ type: 'closing', reason: 'ROOM_CLOSED' });
      expect((await quietApi.call('GET', `/api/play/rooms/${session.code}`)).status).toBe(404);
    } finally {
      await quiet.context.close();
    }
  }, 60_000);

  it('tells every player when the server stops', async () => {
    const stopping = await boot();
    const stoppingApi = new Api(stopping);
    const session = await stoppingApi.create('Alice');
    const client = await stoppingApi.connect(session);
    await client.waitFor((m) => m.type === 'state');
    await stopping.context.close();
    expect(await client.waitClosed()).toBe(1001);
    expect(client.of('closing').at(-1)).toEqual({ type: 'closing', reason: 'SERVER_STOPPING' });
  }, 30_000);
});
