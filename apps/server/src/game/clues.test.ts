import fc from 'fast-check';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FileStorage } from '../modules/images/storage';
import { CLUE_MAX_WIDTH, pixelRect, ZoomOutClues } from './clues/zoom-out';

const WIDTH = 3200;
const HEIGHT = 1800;
let original: Buffer;
let display: Buffer;

beforeAll(async () => {
  const raw = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let index = 0; index < raw.length; index += 3) {
    const pixel = index / 3;
    raw[index] = (pixel % WIDTH) / 13;
    raw[index + 1] = Math.floor(pixel / WIDTH) / 8;
    raw[index + 2] = 90;
  }
  const image = sharp(raw, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } });
  original = await image.clone().webp({ lossless: true, effort: 0 }).toBuffer();
  display = await image.clone().resize({ width: 1600 }).webp().toBuffer();
});

function fakeStorage(): { storage: FileStorage; reads: string[] } {
  const reads: string[] = [];
  const storage = {
    read: (kind: string) => {
      reads.push(kind);
      return Promise.resolve(kind === 'original' ? original : display);
    },
  } as unknown as FileStorage;
  return { storage, reads };
}

/** A limiter that records how many tasks ran at the same time. */
function countingLimiter(max: number) {
  let active = 0;
  const stats = { peak: 0 };
  const waiting: (() => void)[] = [];
  const limit = async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    else active += 1;
    stats.peak = Math.max(stats.peak, active);
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
  return { limit, stats };
}

const rects = (count: number) =>
  Array.from({ length: count }, (_, index) => {
    const scale = 0.15 + (0.85 * index) / Math.max(1, count - 1);
    const w = scale;
    const h = scale;
    return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
  });

describe('pixelRect', () => {
  it('stays inside the picture and at least one pixel, for any frame', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 9000 }),
        fc.integer({ min: 1, max: 9000 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0.0001, max: 1, noNaN: true }),
        fc.double({ min: 0.0001, max: 1, noNaN: true }),
        (width, height, x, y, w, h) => {
          const area = pixelRect({ x, y, w, h }, width, height);
          expect(area.left).toBeGreaterThanOrEqual(0);
          expect(area.top).toBeGreaterThanOrEqual(0);
          expect(area.width).toBeGreaterThanOrEqual(1);
          expect(area.height).toBeGreaterThanOrEqual(1);
          expect(area.left + area.width).toBeLessThanOrEqual(width);
          expect(area.top + area.height).toBeLessThanOrEqual(height);
        },
      ),
    );
  });
});

describe('ZoomOutClues', () => {
  it('reads the original once for every frame of a round, then lets go of it', async () => {
    const { storage, reads } = fakeStorage();
    const clues = new ZoomOutClues({
      storage,
      storageKey: 'a'.repeat(32),
      width: WIDTH,
      height: HEIGHT,
      rects: rects(8),
      limit: (task) => task(),
    });
    await clues.render(0);
    clues.prefetch();
    await Promise.all(Array.from({ length: 8 }, (_, index) => clues.render(index)));
    expect(reads).toEqual(['original']);
    // Frames already rendered stay available without touching the disk again.
    await clues.render(3);
    expect(reads).toEqual(['original']);
    clues.release();
  });

  it('renders frames one at a time within the image concurrency budget', async () => {
    const { storage } = fakeStorage();
    const { limit, stats } = countingLimiter(1);
    const clues = new ZoomOutClues({
      storage,
      storageKey: 'b'.repeat(32),
      width: WIDTH,
      height: HEIGHT,
      rects: rects(6),
      limit,
    });
    await Promise.all(Array.from({ length: 6 }, (_, index) => clues.render(index)));
    expect(stats.peak).toBe(1);
    clues.release();
  });

  it('never sends more than the frame width cap, and never enlarges a small frame', async () => {
    const { storage } = fakeStorage();
    const clues = new ZoomOutClues({
      storage,
      storageKey: 'c'.repeat(32),
      width: WIDTH,
      height: HEIGHT,
      rects: [
        { x: 0, y: 0, w: 1, h: 1 }, // wider than the cap
        { x: 0.4, y: 0.4, w: 0.05, h: 0.05 }, // 160 px
      ],
      limit: (task) => task(),
    });
    const large = await sharp((await clues.render(0)).bytes).metadata();
    const small = await sharp((await clues.render(1)).bytes).metadata();
    expect(large.width).toBe(CLUE_MAX_WIDTH);
    expect(small.width).toBe(160);
    clues.release();
  });

  it('serves nothing once released, including frames being prepared', async () => {
    const { storage } = fakeStorage();
    const clues = new ZoomOutClues({
      storage,
      storageKey: 'd'.repeat(32),
      width: WIDTH,
      height: HEIGHT,
      rects: rects(6),
      limit: (task) => task(),
    });
    await clues.render(0);
    clues.prefetch();
    clues.release();
    await expect(clues.render(1)).rejects.toThrow();
    await expect(clues.renderReveal()).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(clues.render(0)).rejects.toThrow();
  });

  it('refuses a step that does not exist', async () => {
    const { storage } = fakeStorage();
    const clues = new ZoomOutClues({
      storage,
      storageKey: 'e'.repeat(32),
      width: WIDTH,
      height: HEIGHT,
      rects: rects(3),
      limit: (task) => task(),
    });
    await expect(clues.render(3)).rejects.toThrow();
    await expect(clues.render(-1)).rejects.toThrow();
    clues.release();
  });

  it('shows the whole picture from the reduced version, only on request', async () => {
    const { storage, reads } = fakeStorage();
    const clues = new ZoomOutClues({
      storage,
      storageKey: 'f'.repeat(32),
      width: WIDTH,
      height: HEIGHT,
      rects: rects(3),
      limit: (task) => task(),
    });
    expect(reads).toEqual([]);
    const whole = await clues.renderReveal();
    expect(reads).toEqual(['display']);
    expect((await sharp(whole.bytes).metadata()).width).toBe(1600);
    clues.release();
  });
});
