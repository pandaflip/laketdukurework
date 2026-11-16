import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ASPECT_PRESETS,
  aspectRatio,
  buildSteps,
  centerRect,
  checkGenerateInput,
  checkRect,
  checkSteps,
  fitFrame,
  fitSize,
  generateSequence,
  GenerateError,
  maxZoomFor,
  MAX_STEPS,
  moveRect,
  rectCenter,
  zoomOfRect,
  zoomRect,
  type GenerateInput,
  type ImageSize,
  type Rect,
  type StepDraft,
} from '.';

const LANDSCAPE: ImageSize = { width: 1920, height: 1080 };
const PORTRAIT: ImageSize = { width: 1000, height: 1800 };
const SQUARE: ImageSize = { width: 1500, height: 1500 };
const R169 = 16 / 9;

function input(overrides: Partial<GenerateInput> = {}): GenerateInput {
  return {
    image: LANDSCAPE,
    ratio: R169,
    focus: { x: 0.5, y: 0.5 },
    start: { kind: 'zoom', zoom: 8 },
    end: { kind: 'zoom', zoom: 1 },
    steps: 5,
    ...overrides,
  };
}

function expectAllValid(rects: readonly Rect[], image: ImageSize, ratio: number): void {
  rects.forEach((rect, index) => {
    expect(checkRect(rect, image, ratio), `step ${index}`).toBeNull();
  });
}

describe('step counts', () => {
  it.each([1, 2, 5, 15])('generates exactly %i valid frames', (steps) => {
    const { rects } = generateSequence(input({ steps }));
    expect(rects).toHaveLength(steps);
    expectAllValid(rects, LANDSCAPE, R169);
  });

  it('honours the initial zoom on the first frame and the final zoom on the last', () => {
    const { rects } = generateSequence(input({ steps: 15 }));
    expect(zoomOfRect(LANDSCAPE, R169, rects[0] as Rect)).toBeCloseTo(8, 3);
    expect(zoomOfRect(LANDSCAPE, R169, rects[14] as Rect)).toBeCloseTo(1, 3);
  });

  it('uses the initial frame when there is a single step', () => {
    const { rects } = generateSequence(input({ steps: 1 }));
    expect(zoomOfRect(LANDSCAPE, R169, rects[0] as Rect)).toBeCloseTo(8, 3);
  });

  it('widens regularly: zoom strictly decreases, each step by the same factor', () => {
    const { rects } = generateSequence(input({ steps: 15 }));
    const zooms = rects.map((rect) => zoomOfRect(LANDSCAPE, R169, rect));
    for (let i = 1; i < zooms.length; i += 1) {
      expect(zooms[i]).toBeLessThan(zooms[i - 1] as number);
    }
    const factors = zooms.slice(1).map((zoom, i) => (zooms[i] as number) / zoom);
    for (const factor of factors) expect(factor).toBeCloseTo(factors[0] as number, 3);
  });

  it('supports the example: 15 steps from a tight detail to almost the whole picture', () => {
    const { rects } = generateSequence(
      input({
        steps: 15,
        focus: { x: 0.72, y: 0.31 },
        start: { kind: 'zoom', zoom: 10 },
        end: { kind: 'zoom', zoom: 1.1 },
      }),
    );
    expect(rects).toHaveLength(15);
    expect((rects[14] as Rect).w).toBeGreaterThan(0.85);
  });
});

describe('placement', () => {
  it('keeps every frame centered on a focus in the middle of the image', () => {
    const { rects } = generateSequence(input({ steps: 5, end: { kind: 'zoom', zoom: 2 } }));
    for (const rect of rects) {
      expect(rectCenter(rect).x).toBeCloseTo(0.5, 5);
      expect(rectCenter(rect).y).toBeCloseTo(0.5, 5);
    }
  });

  it.each([
    ['top-left corner', { x: 0, y: 0 }],
    ['bottom-right corner', { x: 1, y: 1 }],
    ['left edge', { x: 0, y: 0.5 }],
    ['top edge', { x: 0.5, y: 0 }],
    ['right edge', { x: 1, y: 0.4 }],
  ])('keeps frames inside the image when the focus is on the %s', (_name, focus) => {
    const { rects, warnings } = generateSequence(input({ focus, steps: 15 }));
    expectAllValid(rects, LANDSCAPE, R169);
    // The focus stays visible in every frame.
    for (const rect of rects) {
      expect(focus.x).toBeGreaterThanOrEqual(rect.x - 1e-6);
      expect(focus.x).toBeLessThanOrEqual(rect.x + rect.w + 1e-6);
      expect(focus.y).toBeGreaterThanOrEqual(rect.y - 1e-6);
      expect(focus.y).toBeLessThanOrEqual(rect.y + rect.h + 1e-6);
    }
    expect(warnings.map((warning) => warning.code)).toContain('FRAME_SHIFTED_INSIDE_IMAGE');
  });

  it.each([
    ['landscape', LANDSCAPE],
    ['portrait', PORTRAIT],
    ['square', SQUARE],
  ])('works on a %s image with every ratio preset', (_name, image) => {
    for (const aspect of ASPECT_PRESETS) {
      const ratio = aspectRatio(aspect);
      const { rects } = generateSequence({
        image,
        ratio,
        focus: { x: 0.2, y: 0.8 },
        start: { kind: 'zoom', zoom: 6 },
        end: { kind: 'zoom', zoom: 1 },
        steps: 8,
      });
      expectAllValid(rects, image, ratio);
    }
  });

  it('reports a frame that cannot show the whole picture with this ratio', () => {
    // A 16:9 frame on a portrait image covers the whole width but only part of the height.
    const { rects } = generateSequence(input({ image: PORTRAIT, steps: 3 }));
    const last = rects[2] as Rect;
    expect(last.w).toBeCloseTo(1, 5);
    expect(last.h).toBeLessThan(0.4);
  });

  it('fits the "whole picture" frame', () => {
    const frame = fitFrame(LANDSCAPE, 4 / 3, { x: 0.5, y: 0.5 });
    expect(checkRect(frame, LANDSCAPE, 4 / 3)).toBeNull();
    expect(frame.h).toBeCloseTo(1, 5);
    expect(fitSize(LANDSCAPE, 4 / 3).h).toBeCloseTo(1080, 5);
  });
});

describe('predictable corrections', () => {
  it('brings a zoom below 1 back to the whole-picture frame and says so', () => {
    const { rects, warnings } = generateSequence(input({ end: { kind: 'zoom', zoom: 0.5 } }));
    expect(zoomOfRect(LANDSCAPE, R169, rects[4] as Rect)).toBeCloseTo(1, 3);
    expect(warnings).toContainEqual({ code: 'ZOOM_RAISED_TO_FIT', steps: [4] });
  });

  it('limits a zoom that would make frames too small and says so', () => {
    const small: ImageSize = { width: 400, height: 225 };
    const { rects, warnings } = generateSequence(
      input({ image: small, start: { kind: 'zoom', zoom: 20 } }),
    );
    expect(warnings).toContainEqual({ code: 'ZOOM_LIMITED', steps: [0] });
    expectAllValid(rects, small, R169);
    expect(zoomOfRect(small, R169, rects[0] as Rect)).toBeCloseTo(maxZoomFor(small, R169), 3);
  });

  it('accepts frames as the two ends, centers them, and corrects a wrong ratio', () => {
    const start: Rect = { x: 0.1, y: 0.1, w: 0.2, h: 0.4 }; // 0.89:1 in pixels, not 16:9
    const end: Rect = { x: 0, y: 0, w: 1, h: 1 };
    const { rects, warnings } = generateSequence(
      input({ start: { kind: 'rect', rect: start }, end: { kind: 'rect', rect: end }, steps: 4 }),
    );
    expectAllValid(rects, LANDSCAPE, R169);
    expect(warnings.map((warning) => warning.code)).toContain('RECT_ADJUSTED_TO_RATIO');
    // The first frame stays around the requested one.
    expect(rectCenter(rects[0] as Rect).x).toBeCloseTo(0.2, 1);
    expect(rectCenter(rects[0] as Rect).y).toBeCloseTo(0.3, 1);
  });
});

describe('invalid requests', () => {
  it.each([
    [
      'a start that is not tighter than the end',
      { start: { kind: 'zoom', zoom: 1 } },
      'START_NOT_TIGHTER',
    ],
    ['no step', { steps: 0 }, 'INVALID_STEP_COUNT'],
    ['too many steps', { steps: MAX_STEPS + 1 }, 'INVALID_STEP_COUNT'],
    ['a fractional step count', { steps: 2.5 }, 'INVALID_STEP_COUNT'],
    ['a focus outside the image', { focus: { x: 1.2, y: 0.5 } }, 'INVALID_FOCUS'],
    ['a NaN focus', { focus: { x: Number.NaN, y: 0.5 } }, 'INVALID_FOCUS'],
    ['a zero ratio', { ratio: 0 }, 'INVALID_RATIO'],
    ['an empty image', { image: { width: 0, height: 100 } }, 'INVALID_IMAGE_SIZE'],
    ['a negative zoom', { start: { kind: 'zoom', zoom: -3 } }, 'INVALID_ZOOM'],
    [
      'a frame outside the image',
      { start: { kind: 'rect', rect: { x: 0.8, y: 0, w: 0.5, h: 0.5 } } },
      'INVALID_RECT',
    ],
  ] as const)('refuses %s', (_name, overrides, code) => {
    const request = input(overrides);
    expect(checkGenerateInput(request)).toBe(code);
    expect(() => generateSequence(request)).toThrow(GenerateError);
  });

  it('accepts a single step whatever the zooms', () => {
    expect(checkGenerateInput(input({ steps: 1, start: { kind: 'zoom', zoom: 1 } }))).toBeNull();
  });
});

describe('determinism', () => {
  it('gives the same frames for the same request, and does not depend on the display size', () => {
    const request = input({ steps: 15, focus: { x: 0.37, y: 0.64 } });
    expect(generateSequence(request)).toEqual(generateSequence(request));
    expect(JSON.stringify(generateSequence(request))).toBe(
      JSON.stringify(generateSequence({ ...request })),
    );
    // Same picture at twice the resolution: the normalized frames are identical.
    const bigger = { ...request, image: { width: 3840, height: 2160 } };
    expect(generateSequence(bigger).rects).toEqual(generateSequence(request).rects);
  });
});

describe('manual edits and regeneration', () => {
  const base = buildSteps(input({ steps: 5 })).steps as StepDraft[];

  it('keeps hand-adjusted steps when asked to, and regenerates the others', () => {
    const edited: StepDraft[] = base.map((step, index) =>
      index === 2
        ? { name: 'The sword', rect: moveRect(step.rect, 0.05, 0.02), manual: true }
        : index === 3
          ? { ...step, name: 'Custom name only' }
          : step,
    );
    const result = buildSteps(input({ steps: 5, end: { kind: 'zoom', zoom: 2 } }), edited, true);

    expect(result.steps[2]).toEqual(edited[2]);
    expect(result.droppedManual).toBe(0);
    // Not manual: new frame, but the custom name survives.
    expect(result.steps[3]?.name).toBe('Custom name only');
    expect(result.steps[3]?.rect).not.toEqual(edited[3]?.rect);
    expect(result.steps[3]?.manual).toBe(false);
    expectAllValid(
      result.steps.map((step) => step.rect),
      LANDSCAPE,
      R169,
    );
  });

  it('regenerates everything, names included, when not asked to preserve', () => {
    const edited: StepDraft[] = base.map((step, index) =>
      index === 2 ? { name: 'The sword', rect: moveRect(step.rect, 0.05, 0), manual: true } : step,
    );
    const result = buildSteps(input({ steps: 5 }), edited, false);
    expect(result.steps).toEqual(base);
    expect(result.droppedManual).toBe(0);
  });

  it('counts preserved steps that no longer fit when the sequence gets shorter', () => {
    const edited: StepDraft[] = base.map((step, index) =>
      index === 4 ? { ...step, manual: true } : step,
    );
    const result = buildSteps(input({ steps: 3 }), edited, true);
    expect(result.steps).toHaveLength(3);
    expect(result.droppedManual).toBe(1);
  });

  it('grows: preserved steps keep their position, new positions are generated', () => {
    const edited: StepDraft[] = base.map((step, index) =>
      index === 0 ? { ...step, name: 'First', manual: true } : step,
    );
    const result = buildSteps(input({ steps: 9 }), edited, true);
    expect(result.steps).toHaveLength(9);
    expect(result.steps[0]).toEqual(edited[0]);
  });
});

describe('frame editing helpers', () => {
  const frame = generateSequence(input({ steps: 3 })).rects[0] as Rect;

  it('moves a frame without ever leaving the image', () => {
    const moved = moveRect(frame, 5, -5);
    expect(checkRect(moved, LANDSCAPE, R169)).toBeNull();
    expect(moved.x + moved.w).toBeCloseTo(1, 5);
    expect(moved.y).toBe(0);
  });

  it('re-centers a frame', () => {
    const moved = centerRect(frame, { x: 0.3, y: 0.6 });
    expect(rectCenter(moved).x).toBeCloseTo(0.3, 4);
    expect(rectCenter(moved).y).toBeCloseTo(0.6, 4);
    expect(checkRect(moved, LANDSCAPE, R169)).toBeNull();
  });

  it('changes the zoom around the center, within the allowed range, keeping the ratio', () => {
    const zoomed = zoomRect(LANDSCAPE, R169, frame, 4);
    expect(zoomOfRect(LANDSCAPE, R169, zoomed)).toBeCloseTo(4, 3);
    expect(checkRect(zoomed, LANDSCAPE, R169)).toBeNull();
    expect(zoomOfRect(LANDSCAPE, R169, zoomRect(LANDSCAPE, R169, frame, 0.2))).toBeCloseTo(1, 3);
    expect(zoomOfRect(LANDSCAPE, R169, zoomRect(LANDSCAPE, R169, frame, 500))).toBeCloseTo(
      maxZoomFor(LANDSCAPE, R169),
      3,
    );
  });
});

describe('validation of saved steps', () => {
  const good = generateSequence(input({ steps: 3 })).rects.map((rect) => ({ name: null, rect }));

  it('accepts generated steps', () => {
    expect(checkSteps(good, LANDSCAPE, R169)).toEqual({ ok: true, issues: [], badCount: false });
  });

  it('reports each kind of problem with the step it concerns', () => {
    const rect = good[0]?.rect as Rect;
    const check = (step: { name: string | null; rect: Rect }) =>
      checkSteps([step], LANDSCAPE, R169).issues[0]?.code;
    expect(check({ name: null, rect: { ...rect, x: Number.NaN } })).toBe('NOT_FINITE');
    expect(check({ name: null, rect: { ...rect, x: 0.95 } })).toBe('OUT_OF_BOUNDS');
    expect(check({ name: null, rect: { ...rect, w: rect.w * 1.2 } })).toBe('WRONG_RATIO');
    expect(
      check({
        name: null,
        rect: { x: 0, y: 0, w: 0.005, h: 0.005 * (1920 / 1080) * (9 / 16) * (16 / 9) },
      }),
    ).toBe('WRONG_RATIO');
    expect(check({ name: 'x'.repeat(81), rect })).toBe('NAME_TOO_LONG');
    expect(checkSteps([], LANDSCAPE, R169).badCount).toBe(true);
    expect(checkSteps(Array(MAX_STEPS + 1).fill(good[0]), LANDSCAPE, R169).badCount).toBe(true);
  });

  it('refuses a frame smaller than the minimum size', () => {
    const w = 10 / 1920;
    const h = (10 * 9) / 16 / 1080;
    expect(checkRect({ x: 0, y: 0, w, h }, LANDSCAPE, R169)).toBe('TOO_SMALL');
  });
});

describe('properties', () => {
  const imageArb = fc.record({
    width: fc.integer({ min: 200, max: 6000 }),
    height: fc.integer({ min: 200, max: 6000 }),
  });
  const ratioArb = fc.constantFrom(...ASPECT_PRESETS.map(aspectRatio));
  const unitArb = fc.double({ min: 0, max: 1, noNaN: true });

  it('every generated frame is valid, for any image, ratio, focus, zoom and length', () => {
    fc.assert(
      fc.property(
        imageArb,
        ratioArb,
        unitArb,
        unitArb,
        fc.double({ min: 0.2, max: 30, noNaN: true }),
        fc.double({ min: 0.2, max: 30, noNaN: true }),
        fc.integer({ min: 1, max: MAX_STEPS }),
        (image, ratio, fx, fy, a, b, steps) => {
          const request: GenerateInput = {
            image,
            ratio,
            focus: { x: fx, y: fy },
            start: { kind: 'zoom', zoom: Math.max(a, b) },
            end: { kind: 'zoom', zoom: Math.min(a, b) },
            steps,
          };
          if (checkGenerateInput(request) !== null) return; // equal zooms with several steps
          const { rects } = generateSequence(request);
          expect(rects).toHaveLength(steps);
          expectAllValid(rects, image, ratio);
          expect(generateSequence(request)).toEqual({
            rects,
            warnings: generateSequence(request).warnings,
          });
        },
      ),
      { numRuns: 500 },
    );
  });
});
