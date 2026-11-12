import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ASPECT_PRESETS,
  aspectRatio,
  checkRect,
  clampZone,
  createRng,
  DEFAULT_RANDOM_ZONE,
  DEFAULT_RANDOM_ZOOM_END,
  DEFAULT_RANDOM_ZOOM_START,
  generateRandomSequence,
  MAX_RANDOM_ZONE,
  MIN_RANDOM_ZONE,
  randomFocus,
  zoomOfRect,
  type ImageSize,
  type RandomSequenceInput,
} from '.';

const request = (
  image: ImageSize,
  overrides: Partial<RandomSequenceInput> = {},
): RandomSequenceInput => ({
  image,
  ratio: 16 / 9,
  start: { kind: 'zoom', zoom: DEFAULT_RANDOM_ZOOM_START },
  end: { kind: 'zoom', zoom: DEFAULT_RANDOM_ZOOM_END },
  steps: 5,
  ...overrides,
});

/** The value, or a clear failure when a test expected it to exist. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

const IMAGES: [string, ImageSize][] = [
  ['landscape', { width: 1215, height: 717 }],
  ['wide landscape', { width: 3840, height: 1200 }],
  ['portrait', { width: 1000, height: 1800 }],
  ['tall portrait', { width: 600, height: 2400 }],
  ['square', { width: 1500, height: 1500 }],
];

describe('the default settings', () => {
  it('are a ×12 to ×1 zoom drawn in the central 60% of the picture', () => {
    expect(DEFAULT_RANDOM_ZOOM_START).toBe(12);
    expect(DEFAULT_RANDOM_ZOOM_END).toBe(1);
    expect(DEFAULT_RANDOM_ZONE).toBe(0.6);
  });
});

describe('randomFocus', () => {
  it('draws inside the central zone, for any generator output', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (a, b) => {
          const values = [a, b];
          const focus = randomFocus(() => values.shift() ?? 0);
          expect(focus.x).toBeGreaterThanOrEqual(0.2 - 1e-9);
          expect(focus.x).toBeLessThanOrEqual(0.8 + 1e-9);
          expect(focus.y).toBeGreaterThanOrEqual(0.2 - 1e-9);
          expect(focus.y).toBeLessThanOrEqual(0.8 + 1e-9);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('reaches both ends of the zone and the middle', () => {
    expect(randomFocus(() => 0)).toEqual({ x: 0.2, y: 0.2 });
    expect(randomFocus(() => 0.5)).toEqual({ x: 0.5, y: 0.5 });
    expect(randomFocus(() => 0.999999999)).toEqual({ x: 0.8, y: 0.8 });
  });

  it('follows the configured zone, and keeps it within sensible bounds', () => {
    expect(randomFocus(() => 0, 1)).toEqual({ x: 0, y: 0 });
    expect(randomFocus(() => 1, 1)).toEqual({ x: 1, y: 1 });
    expect(randomFocus(() => 0, 0.4)).toEqual({ x: 0.3, y: 0.3 });
    // Too narrow, too wide or not a number: brought back to what is allowed.
    expect(clampZone(0.01)).toBe(MIN_RANDOM_ZONE);
    expect(clampZone(7)).toBe(MAX_RANDOM_ZONE);
    expect(clampZone(Number.NaN)).toBe(DEFAULT_RANDOM_ZONE);
    expect(randomFocus(() => 0, 0.01)).toEqual({ x: 0.4, y: 0.4 });
  });

  it('never leaves the picture, even if the generator misbehaves', () => {
    for (const value of [-5, 7, Number.NaN]) {
      const focus = randomFocus(() => value, 1);
      expect(focus.x).toBeGreaterThanOrEqual(0);
      expect(focus.x).toBeLessThanOrEqual(1);
    }
  });

  it('is reproducible with a seed, and spreads over the zone', () => {
    const draw = (seed: number) => {
      const random = createRng(seed);
      return Array.from({ length: 200 }, () => randomFocus(random));
    };
    expect(draw(42)).toEqual(draw(42));
    expect(draw(42)).not.toEqual(draw(43));
    const xs = draw(1).map((focus) => focus.x);
    expect(Math.min(...xs)).toBeLessThan(0.28);
    expect(Math.max(...xs)).toBeGreaterThan(0.72);
    expect(new Set(xs).size).toBeGreaterThan(150);
  });
});

describe('generateRandomSequence', () => {
  it.each(IMAGES)('makes valid frames on a %s picture, with every ratio', (_name, image) => {
    for (const aspect of ASPECT_PRESETS) {
      const ratio = aspectRatio(aspect);
      const random = createRng(image.width + aspect.w);
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const { focus, steps } = generateRandomSequence(
          request(image, { ratio, steps: 6 }),
          random,
        );
        expect(steps).toHaveLength(6);
        for (const step of steps) {
          expect(checkRect(step.rect, image, ratio)).toBeNull();
          expect(step.manual).toBe(false);
          // The drawn focus is visible in every frame.
          expect(focus.x).toBeGreaterThanOrEqual(step.rect.x - 1e-6);
          expect(focus.x).toBeLessThanOrEqual(step.rect.x + step.rect.w + 1e-6);
          expect(focus.y).toBeGreaterThanOrEqual(step.rect.y - 1e-6);
          expect(focus.y).toBeLessThanOrEqual(step.rect.y + step.rect.h + 1e-6);
        }
      }
    }
  });

  it('keeps frames valid when the zone reaches the very edges', () => {
    for (const value of [0, 0.999999999]) {
      for (const [, image] of IMAGES) {
        const { focus, steps } = generateRandomSequence(
          request(image, { zone: 1, steps: 8 }),
          () => value,
        );
        expect(focus.x === 0 || focus.x === 1).toBe(true);
        for (const step of steps) expect(checkRect(step.rect, image, 16 / 9)).toBeNull();
      }
    }
  });

  it('uses the existing generator: first and last frame follow the requested zooms', () => {
    const image = { width: 1920, height: 1080 };
    const { steps } = generateRandomSequence(request(image, { steps: 15 }), createRng(7));
    expect(steps).toHaveLength(15);
    expect(zoomOfRect(image, 16 / 9, must(steps[0]).rect)).toBeCloseTo(12, 3);
    expect(zoomOfRect(image, 16 / 9, must(steps[14]).rect)).toBeCloseTo(1, 3);
  });

  it.each([1, 2, 5, 15, 100])('works with %i steps', (count) => {
    const { steps } = generateRandomSequence(
      request(must(IMAGES[0])[1], { steps: count }),
      createRng(count),
    );
    expect(steps).toHaveLength(count);
  });

  it('reports the same corrections as the ordinary generator', () => {
    const tiny = { width: 400, height: 225 };
    const { warnings } = generateRandomSequence(
      request(tiny, { start: { kind: 'zoom', zoom: 20 } }),
      createRng(3),
    );
    expect(warnings.map((warning) => warning.code)).toContain('ZOOM_LIMITED');
  });

  it('draws again on every call: a new focus and a new sequence', () => {
    const image = { width: 1215, height: 717 };
    const random = createRng(99);
    const first = generateRandomSequence(request(image), random);
    const second = generateRandomSequence(request(image), random);
    expect(second.focus).not.toEqual(first.focus);
    expect(second.steps).not.toEqual(first.steps);
    // The same generator state gives the same draw: nothing is hidden.
    expect(generateRandomSequence(request(image), createRng(99))).toEqual(first);
  });

  it('refuses what the generator refuses, with the same error', () => {
    const image = { width: 1215, height: 717 };
    expect(() =>
      generateRandomSequence(request(image, { start: { kind: 'zoom', zoom: 1 } }), createRng(1)),
    ).toThrow('START_NOT_TIGHTER');
    expect(() => generateRandomSequence(request(image, { steps: 0 }), createRng(1))).toThrow(
      'INVALID_STEP_COUNT',
    );
  });
});
