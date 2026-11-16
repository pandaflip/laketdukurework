import type { CharacterDto, ImageDto, UniverseDto } from '@app/shared';
import { COUNTDOWN_MS, createRng, REVEAL_MS, roomConfigSchema, type RoomConfig } from '@app/shared';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadCatalog } from '../src/game/candidates';
import { Match } from '../src/game/match';
import { ChallengePool } from '../src/game/pool';
import { createLimiter } from '../src/modules/images/processing';
import { FileStorage } from '../src/modules/images/storage';
import { importPicture, saveSequenceOf } from './image-helpers';
import {
  adminClient,
  createReviewedUniverse,
  startApp,
  type Client,
  type TestContext,
} from './helpers';

let context: TestContext;
let admin: Client;
let universe: UniverseDto;
let seed = 0;

beforeEach(async () => {
  context = await startApp();
  admin = await adminClient(context);
  universe = await createReviewedUniverse(admin, 'League of Legends');
});
afterEach(async () => {
  await context.close();
});

interface Playable {
  readonly character: CharacterDto;
  readonly image: ImageDto;
}

/** A character with one picture, a saved sequence and an individual approval. */
async function playable(
  name: string,
  options: {
    steps?: number;
    review?: 'APPROVED_NEUTRAL' | 'REJECTED' | null;
    universeId?: string;
    aliases?: Record<string, string[]>;
    names?: Record<string, string>;
    /** Pins the picture pattern (the default is a new pattern each time). */
    pattern?: number;
  } = {},
): Promise<Playable> {
  const { steps = 5, review = 'APPROVED_NEUTRAL', universeId = universe.id } = options;
  const created = await admin.post('/characters', {
    universeId,
    names: options.names ?? { en: name },
    ...(options.aliases === undefined ? {} : { aliases: options.aliases }),
  });
  expect(created.statusCode, created.body).toBe(200);
  const character = created.json<CharacterDto>();
  seed += 1;
  const image = await importPicture(admin, character.id, { seed: options.pattern ?? seed });
  await saveSequenceOf(admin, image, steps);
  if (review !== null) {
    const reviewed = await admin.put(`/images/${image.id}/review`, { review });
    expect(reviewed.statusCode, reviewed.body).toBe(200);
  }
  return { character, image };
}

function pool(config: Partial<RoomConfig> = {}, randomSeed = 1): Promise<ChallengePool> {
  return ChallengePool.open(
    {
      db: context.db,
      storage: new FileStorage(context.storageDir),
      limit: createLimiter(2),
      random: createRng(randomSeed),
    },
    roomConfigSchema.parse(config),
  );
}

async function drain(source: ChallengePool): Promise<string[]> {
  const names: string[] = [];
  for (let next = await source.next(); next; next = await source.next()) {
    names.push(next.answer.names.en);
    next.clues.release();
  }
  return names;
}

describe('which images can be drawn', () => {
  it('keeps only approved, eligible, reviewed images with a sequence', async () => {
    await playable('Ahri');
    await playable('Zed');
    await playable('Unverified One', { review: null });
    await playable('Rejected One', { review: 'REJECTED' });
    const excluded = await playable('Excluded One');
    await admin.put(`/characters/${excluded.character.id}/status`, { status: 'EXCLUDED' });
    const elsewhere = await createReviewedUniverse(admin, 'Other Game', ['pixelated']);
    await playable('Other Mode', { universeId: elsewhere.id });

    const source = await pool();
    expect(source.size).toBe(2);
    expect((await drain(source)).sort()).toEqual(['Ahri', 'Zed']);
  });

  it('draws only images approved for neutral use: a sensitive approval is not enough', async () => {
    await playable('Ahri');
    const approvedForSensitiveUse = await playable('Zed');
    await context.db.asset.update({
      where: { id: approvedForSensitiveUse.image.id },
      data: { review: 'APPROVED_SENSITIVE' },
    });
    const source = await pool();
    expect(source.size).toBe(1);
    expect(await drain(source)).toEqual(['Ahri']);

    // And an approval that changes to sensitive after the draw is caught just before the round.
    const early = await pool();
    await context.db.asset.updateMany({ where: {}, data: { review: 'APPROVED_SENSITIVE' } });
    expect(await drain(early)).toEqual([]);
  });

  it('never draws the same character or the same image twice', async () => {
    const first = await playable('Ahri');
    seed += 1;
    const second = await importPicture(admin, first.character.id, { seed });
    await saveSequenceOf(admin, second, 4);
    await admin.put(`/images/${second.id}/review`, { review: 'APPROVED_NEUTRAL' });
    await playable('Zed');
    await playable('Karma');

    const source = await pool();
    expect(source.size).toBe(3);
    const names = await drain(source);
    expect(names.sort()).toEqual(['Ahri', 'Karma', 'Zed']);
  });

  it('draws in a random order that a given seed replays', async () => {
    for (const name of ['Ahri', 'Zed', 'Karma', 'Sona', 'Nami', 'Lux', 'Jinx', 'Vi']) {
      await playable(name);
    }
    const a = await drain(await pool({}, 7));
    const b = await drain(await pool({}, 7));
    const c = await drain(await pool({}, 8));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(new Set(a).size).toBe(8);
  });

  it('honours the universe filters, and finds nothing for a category before categories exist', async () => {
    const other = await createReviewedUniverse(admin, 'Pokemon-like');
    await playable('Ahri');
    await playable('Pikachu', { universeId: other.id });
    expect((await pool({ filter: { universes: [universe.slug] } as never })).size).toBe(1);
    expect((await pool({ filter: { excludeUniverses: [universe.slug] } as never })).size).toBe(1);
    expect((await pool({ filter: { include: ['mage'] } as never })).size).toBe(0);
    expect((await pool({ filter: { exclude: ['mage'] } as never })).size).toBe(2);
  });

  it('leaves out a character that no answer could identify', async () => {
    // The same official name in two universes: typing it could mean either.
    const other = await createReviewedUniverse(admin, 'Other Game');
    await playable('Echo');
    await playable('Echo', { universeId: other.id });
    await playable('Ahri');
    const source = await pool();
    expect(source.size).toBe(1);
    expect(await drain(source)).toEqual(['Ahri']);
  });
});

describe('re-evaluation just before each round', () => {
  it('skips an image rejected after the game started', async () => {
    const ahri = await playable('Ahri');
    await playable('Zed');
    const source = await pool();
    await admin.put(`/images/${ahri.image.id}/review`, { review: 'REJECTED' });
    expect(await drain(source)).toEqual(['Zed']);
  });

  it('skips a character excluded after the game started', async () => {
    const ahri = await playable('Ahri');
    await playable('Zed');
    const source = await pool();
    await admin.put(`/characters/${ahri.character.id}/status`, { status: 'EXCLUDED' });
    expect(await drain(source)).toEqual(['Zed']);
  });

  it('skips an image whose frames were edited, since that withdraws its approval', async () => {
    const ahri = await playable('Ahri');
    await playable('Zed');
    const source = await pool();
    await saveSequenceOf(admin, ahri.image, 6);
    expect(await drain(source)).toEqual(['Zed']);
  });

  it('skips a universe that stopped offering the mode', async () => {
    await playable('Ahri');
    const other = await createReviewedUniverse(admin, 'Other Game');
    await playable('Pikachu', { universeId: other.id });
    const source = await pool();
    await admin.put(`/universes/${other.id}`, { name: 'Other Game', enabledModes: ['pixelated'] });
    expect(await drain(source)).toEqual(['Ahri']);
  });

  it('skips an image whose file is gone, without failing the game', async () => {
    const ahri = await playable('Ahri');
    await playable('Zed');
    const source = await pool();
    await admin.delete(`/images/${ahri.image.id}`);
    expect(await drain(source)).toEqual(['Zed']);
  });
});

describe('steps of a round', () => {
  it('plays the requested number of steps, spread over the saved ones, or all of them if fewer', async () => {
    await playable('Ahri', { steps: 15 });
    await playable('Zed', { steps: 4 });
    const source = await pool({ steps: 5 });
    const counts = new Map<string, number>();
    for (let next = await source.next(); next; next = await source.next()) {
      counts.set(next.answer.names.en, next.clues.count);
      next.clues.release();
    }
    expect(counts.get('Ahri')).toBe(5);
    expect(counts.get('Zed')).toBe(4);
  });
});

describe('answers against the real catalog', () => {
  it('accepts names, aliases and typos as configured, and refuses lookalikes', async () => {
    await playable('LeBlanc', { aliases: { en: ['LB'] }, names: { en: 'LeBlanc', fr: 'Leblanc' } });
    await playable('Maokai');
    await playable('Maokal');
    await playable('Karma');
    await playable('Sona');

    const strict = await pool({ typoTolerance: false, aliases: false });
    const loose = await pool({ typoTolerance: true, aliases: true });
    const find = async (source: ChallengePool, name: string) => {
      for (let next = await source.next(); next; next = await source.next()) {
        if (next.answer.names.en === name) return next;
        next.clues.release();
      }
      throw new Error(`${name} was not drawn`);
    };
    const leblanc = await find(loose, 'LeBlanc');
    expect(leblanc.answer.accepts('leblanc', { typoTolerance: false, aliases: false })).toBe(true);
    expect(leblanc.answer.accepts('Leblacn', { typoTolerance: true, aliases: false })).toBe(true);
    expect(leblanc.answer.accepts('Leblacn', { typoTolerance: false, aliases: false })).toBe(false);
    expect(leblanc.answer.accepts('LB', { typoTolerance: false, aliases: true })).toBe(true);
    expect(leblanc.answer.accepts('LB', { typoTolerance: true, aliases: false })).toBe(false);
    expect(leblanc.answer.isRelated('LB')).toBe(true);
    expect(leblanc.answer.accepts('Karma', { typoTolerance: true, aliases: true })).toBe(false);

    const maokai = await find(strict, 'Maokai');
    expect(maokai.answer.accepts('Maokay', { typoTolerance: true, aliases: true })).toBe(false);
    expect(maokai.answer.accepts('Maokai', { typoTolerance: true, aliases: true })).toBe(true);
    expect(maokai.answer.accepts('Maokal', { typoTolerance: true, aliases: true })).toBe(false);
  });

  it('suggests the whole non-excluded catalog by language, whatever the draw', async () => {
    await playable('Ahri', { names: { en: 'Ahri', fr: 'Ahri' } });
    await playable('The Mage', { names: { en: 'The Mage', fr: 'Le Mage' } });
    const hidden = await playable('Hidden One');
    await admin.put(`/characters/${hidden.character.id}/status`, { status: 'EXCLUDED' });
    // A character with no image at all is still typeable.
    await admin.post('/characters', { universeId: universe.id, names: { en: 'No Picture' } });

    const { suggestions } = await loadCatalog(context.db);
    expect(suggestions.en).toEqual(['Ahri', 'No Picture', 'The Mage']);
    expect(suggestions.fr).toEqual(['Ahri', 'Le Mage', 'No Picture']);
    expect(JSON.stringify(suggestions)).not.toContain('Hidden One');
  });
});

describe('pictures shown to players', () => {
  it('cuts each frame from the original, at a size players can use, with no metadata', async () => {
    await playable('Ahri', { steps: 5 });
    await playable('Zed');
    await playable('Karma');
    await playable('Sona');
    await playable('Nami');
    const source = await pool({ steps: 5 });
    const challenge = await source.next();
    if (!challenge) throw new Error('nothing drawn');
    expect(challenge.clues.count).toBe(5);

    const first = await challenge.clues.render(0);
    const last = await challenge.clues.render(4);
    expect(first.contentType).toBe('image/webp');
    for (const frame of [first, last]) {
      const info = await sharp(frame.bytes).metadata();
      expect(info.format).toBe('webp');
      expect(info.exif).toBeUndefined();
      expect(info.icc).toBeUndefined();
      expect(info.width).toBeLessThanOrEqual(960);
      expect(info.width / info.height).toBeCloseTo(16 / 9, 1);
    }
    // The most zoomed frame is a small part of the picture, the last one the largest.
    const firstInfo = await sharp(first.bytes).metadata();
    const lastInfo = await sharp(last.bytes).metadata();
    expect(firstInfo.width).toBeLessThan(lastInfo.width);
    expect(first.bytes.equals(last.bytes)).toBe(false);

    const whole = await challenge.clues.renderReveal();
    const wholeInfo = await sharp(whole.bytes).metadata();
    expect(wholeInfo.width).toBeLessThanOrEqual(1600);
    challenge.clues.release();
  });

  it('shows the right region of the picture', async () => {
    // The synthetic picture is a horizontal gradient (red grows with x), and the
    // helper puts the focus 60% across: the first frame is centred there.
    await playable('Ahri', { steps: 5, pattern: 0 });
    const source = await pool({ steps: 5 });
    const challenge = await source.next();
    if (!challenge) throw new Error('nothing drawn');
    const { channels } = await sharp((await challenge.clues.render(0)).bytes).stats();
    expect(channels[0]?.mean).toBeGreaterThan(0.5 * 255);
    expect(channels[0]?.mean).toBeLessThan(0.7 * 255);
    challenge.clues.release();
  });

  it('keeps the whole picture and the next frames away from players during a game', async () => {
    for (const name of ['Ahri', 'Zed', 'Karma', 'Sona', 'Nami']) await playable(name);
    const source = await pool({ steps: 5, stepDelaySec: 3 });
    let counter = 0;
    const match = new Match({ newId: () => `id${(counter += 1)}` });
    const players = ['Alice', 'Bob'].map((nickname) => {
      const joined = match.addPlayer(nickname);
      if (!joined.ok) throw new Error(joined.reason);
      return joined.playerId;
    });
    const [host, guest] = players as [string, string];
    match.configure(host, { steps: 5, stepDelaySec: 3 });
    const t0 = 1_000_000;
    match.start(host, source.size, t0);
    const challenge = await source.next();
    if (!challenge) throw new Error('nothing drawn');
    const answer = challenge.answer.names.en;
    match.provideChallenge(challenge, t0);
    match.tick(t0 + COUNTDOWN_MS);
    const started = t0 + COUNTDOWN_MS;

    const outputs: string[] = [];
    const record = (at: number): void => {
      outputs.push(
        JSON.stringify(match.publicView(at)),
        JSON.stringify(match.privateView(guest, at)),
      );
    };
    record(started);
    const firstToken = match.publicView(started).round?.frameToken;
    match.tick(started + 3_000);
    record(started + 3_000);
    for (const text of outputs) {
      expect(text).not.toContain(answer);
      expect(text).not.toContain('League of Legends');
    }

    const view = match.publicView(started + 3_000);
    expect(view.round?.stepIndex).toBe(1);
    const frame = await match.openFrame(view.round?.frameToken ?? '', guest);
    expect(frame?.contentType).toBe('image/webp');
    // The picture of a later step has no address yet.
    expect(view.round?.frameToken).not.toBe(firstToken);
    expect(await match.openFrame('guessed-address', guest)).toBeNull();

    // Both find it: the answer and the whole picture appear, and only now.
    expect(match.answer(host, 1, answer, started + 3_500).status).toBe('correct');
    expect(match.answer(guest, 1, answer.toUpperCase(), started + 3_600).status).toBe('correct');
    const revealed = match.publicView(started + 3_600);
    expect(revealed.reveal?.names.en).toBe(answer);
    const whole = await match.openFrame(revealed.reveal?.frameToken ?? '', guest);
    expect((await sharp(whole?.bytes ?? Buffer.alloc(0)).metadata()).width).toBeLessThanOrEqual(
      1600,
    );
    match.tick(started + 3_600 + REVEAL_MS);
    match.close();
  });
});
