import type { ServerMessage } from '@app/shared';
import type { Timers } from '../src/game/runtime';
import WebSocket from 'ws';

/** A game clock the test moves by hand: nothing happens until `advance`. */
export class ManualTimers implements Timers {
  private current = 1_000_000;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();
  private counter = 0;

  now(): number {
    return this.current;
  }

  setTimer(delayMs: number, callback: () => void): () => void {
    const id = (this.counter += 1);
    this.timers.set(id, { at: this.current + Math.max(0, delayMs), callback });
    return () => {
      this.timers.delete(id);
    };
  }

  /** Moves the clock, running every timer that falls due, in order. */
  async advance(ms: number): Promise<void> {
    const target = this.current + ms;
    for (;;) {
      let next: [number, { at: number; callback: () => void }] | undefined;
      for (const entry of this.timers) {
        if (entry[1].at <= target && (!next || entry[1].at < next[1].at)) next = entry;
      }
      if (!next) break;
      this.timers.delete(next[0]);
      this.current = Math.max(this.current, next[1].at);
      next[1].callback();
      await new Promise((resolve) => setImmediate(resolve));
    }
    this.current = target;
    await new Promise((resolve) => setImmediate(resolve));
  }

  get pending(): number {
    return this.timers.size;
  }
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class Refused extends Error {
  constructor(readonly status: number) {
    super(`refused with HTTP ${status}`);
  }
}

/** A test WebSocket client that records everything the server sends. */
export class PlayClient {
  readonly messages: ServerMessage[] = [];
  closeCode: number | null = null;

  private constructor(private readonly socket: WebSocket) {
    socket.on('message', (data: Buffer) => {
      this.messages.push(JSON.parse(data.toString('utf8')) as ServerMessage);
    });
    socket.on('close', (code: number) => {
      this.closeCode = code;
    });
  }

  static open(url: string, headers: Record<string, string>): Promise<PlayClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, { headers });
      const client = new PlayClient(socket);
      socket.once('open', () => {
        resolve(client);
      });
      socket.once('unexpected-response', (_request, response) => {
        reject(new Refused(response.statusCode ?? 0));
      });
      socket.once('error', (error: Error) => {
        reject(error);
      });
    });
  }

  send(message: unknown): void {
    this.socket.send(typeof message === 'string' ? message : JSON.stringify(message));
  }

  sendRaw(data: string | Buffer, binary = false): void {
    this.socket.send(data, { binary });
  }

  close(): void {
    this.socket.close();
  }

  terminate(): void {
    this.socket.terminate();
  }

  async waitFor(
    predicate: (message: ServerMessage) => boolean,
    timeoutMs = 8_000,
  ): Promise<ServerMessage> {
    const started = Date.now();
    let seen = 0;
    for (;;) {
      for (; seen < this.messages.length; seen++) {
        const message = this.messages[seen];
        if (message && predicate(message)) return message;
      }
      if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for a message');
      await sleep(10);
    }
  }

  async waitClosed(timeoutMs = 8_000): Promise<number> {
    const started = Date.now();
    while (this.closeCode === null) {
      if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for the close');
      await sleep(10);
    }
    return this.closeCode;
  }

  of<Type extends ServerMessage['type']>(type: Type): Extract<ServerMessage, { type: Type }>[] {
    return this.messages.filter(
      (message): message is Extract<ServerMessage, { type: Type }> => message.type === type,
    );
  }

  state(): Extract<ServerMessage, { type: 'state' }> | undefined {
    return this.of('state').at(-1);
  }
}
