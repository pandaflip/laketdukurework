import type { ServerMessage } from '@app/shared';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ManualTimers } from '../../test/play-helpers';
import { testConfig } from '../../test/helpers';
import { Room, type Connection } from './room';

class FakeConnection implements Connection {
  readonly sent: ServerMessage[] = [];
  closedWith: number | null = null;
  send(message: ServerMessage): boolean {
    this.sent.push(message);
    return true;
  }
  close(code: number): void {
    this.closedWith = code;
  }
}

function room(): { room: Room; timers: ManualTimers } {
  const timers = new ManualTimers();
  return {
    timers,
    room: new Room({
      code: 'ABCDEF',
      createdByIp: '10.0.0.1',
      config: testConfig(),
      timers,
      openPool: () => Promise.reject(new Error('no pool in this test')),
      poolSize: () => Promise.resolve(0),
      suggestions: () => Promise.resolve([]),
      onClosed: () => undefined,
    }),
  };
}

const joined = (target: Room, nickname: string): string => {
  const result = target.join(nickname, 'en');
  if (!result.ok) throw new Error(result.reason);
  return result.playerId;
};

describe('Room identity', () => {
  it('only acts for the player a connection was attached to', () => {
    const { room: target } = room();
    const host = joined(target, 'Host');
    const guest = joined(target, 'Guest');
    const hostConnection = new FakeConnection();
    const guestConnection = new FakeConnection();
    target.attach(host, hostConnection);
    target.attach(guest, guestConnection);

    // The guest's connection cannot use the host's identity, whatever it claims.
    target.receive(host, guestConnection, JSON.stringify({ type: 'start' }));
    expect(guestConnection.closedWith).toBe(1008);
    expect(target.match.phase).toBe('lobby');
  });

  it('ignores a connection that was replaced, and closes it', () => {
    const { room: target } = room();
    const player = joined(target, 'Alice');
    const first = new FakeConnection();
    const second = new FakeConnection();
    target.attach(player, first);
    target.attach(player, second);
    expect(first.closedWith).toBe(4001);
    expect(first.sent).toContainEqual({ type: 'closing', reason: 'REPLACED' });

    // The old connection still talks: nothing happens, and it is cut again.
    first.closedWith = null;
    target.receive(player, first, JSON.stringify({ type: 'leave' }));
    expect(first.closedWith).toBe(1008);
    expect(target.memberCount).toBe(1);
    expect(second.closedWith).toBeNull();
    // Detaching the stale connection does not disconnect the live one.
    target.detach(player, first);
    expect(target.connectedCount).toBe(1);
  });

  it('refuses a connection for someone who is not in the room', () => {
    const { room: target } = room();
    const stranger = new FakeConnection();
    target.attach('a'.repeat(32), stranger);
    expect(stranger.closedWith).toBe(1008);
    target.receive('a'.repeat(32), stranger, JSON.stringify({ type: 'vote', stepIndex: 0 }));
    expect(stranger.sent).toEqual([]);
  });

  it('authenticates only the secret that was issued, and keeps no secret', () => {
    const { room: target } = room();
    const result = target.join('Alice', 'en');
    if (!result.ok) throw new Error('join failed');
    expect(target.authenticate(result.playerId, result.secret)).toBe(true);
    expect(target.authenticate(result.playerId, '0'.repeat(64))).toBe(false);
    expect(target.authenticate('b'.repeat(32), result.secret)).toBe(false);
    expect(inspect(target, { depth: 6, maxStringLength: 1_000 })).not.toContain(result.secret);
  });
});

describe('Room absence', () => {
  it('reports a player absent only after the grace delay, and not at all if they come back', async () => {
    const { room: target, timers } = room();
    const player = joined(target, 'Alice');
    const other = joined(target, 'Bob');
    const connection = new FakeConnection();
    target.attach(player, connection);
    target.attach(other, new FakeConnection());

    target.detach(player, connection);
    await timers.advance(4_900);
    expect(target.match.publicView(timers.now()).players[0]?.connected).toBe(true);
    const back = new FakeConnection();
    target.attach(player, back);
    await timers.advance(10_000);
    expect(target.match.publicView(timers.now()).players[0]?.connected).toBe(true);

    target.detach(player, back);
    await timers.advance(5_000);
    expect(target.match.publicView(timers.now()).players[0]?.connected).toBe(false);
  });
});
