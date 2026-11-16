import { MAX_STEPS, MIN_ZOOM } from './constants';
import {
  clamp,
  maxZoomFor,
  placeRect,
  rectCenter,
  roundRect,
  zoomOfRect,
  type ImageSize,
  type Point,
  type Rect,
} from './geometry';

/** One end of the sequence: a zoom level (centered on the focus) or a frame. */
export type Endpoint =
  { readonly kind: 'zoom'; readonly zoom: number } | { readonly kind: 'rect'; readonly rect: Rect };

export interface GenerateInput {
  readonly image: ImageSize;
  /** Width / height of the game display. */
  readonly ratio: number;
  /** Focus point, normalized. */
  readonly focus: Point;
  readonly start: Endpoint;
  readonly end: Endpoint;
  readonly steps: number;
}

/** Adjustments the generator made to honour the request as closely as it could. */
export const GENERATION_WARNING_CODES = [
  'ZOOM_RAISED_TO_FIT',
  'ZOOM_LIMITED',
  'RECT_ADJUSTED_TO_RATIO',
  'FRAME_SHIFTED_INSIDE_IMAGE',
] as const;
export type GenerationWarningCode = (typeof GENERATION_WARNING_CODES)[number];

export interface GenerationWarning {
  readonly code: GenerationWarningCode;
  /** Zero-based indexes of the affected steps. */
  readonly steps: readonly number[];
}

export interface GenerateResult {
  readonly rects: readonly Rect[];
  readonly warnings: readonly GenerationWarning[];
}

export const GENERATE_ERROR_CODES = [
  'INVALID_IMAGE_SIZE',
  'INVALID_RATIO',
  'INVALID_STEP_COUNT',
  'INVALID_FOCUS',
  'INVALID_ZOOM',
  'INVALID_RECT',
  'START_NOT_TIGHTER',
] as const;
export type GenerateErrorCode = (typeof GENERATE_ERROR_CODES)[number];

export class GenerateError extends Error {
  constructor(readonly code: GenerateErrorCode) {
    super(code);
    this.name = 'GenerateError';
  }
}

const finite = (value: number): boolean => Number.isFinite(value);
const unit = (value: number): boolean => finite(value) && value >= 0 && value <= 1;

function endpointZoom(input: GenerateInput, endpoint: Endpoint): number {
  return endpoint.kind === 'zoom'
    ? endpoint.zoom
    : zoomOfRect(input.image, input.ratio, endpoint.rect);
}

function endpointIssue(endpoint: Endpoint): GenerateErrorCode | null {
  if (endpoint.kind === 'zoom') {
    return finite(endpoint.zoom) && endpoint.zoom > 0 ? null : 'INVALID_ZOOM';
  }
  const { x, y, w, h } = endpoint.rect;
  return unit(x) &&
    unit(y) &&
    finite(w) &&
    finite(h) &&
    w > 0 &&
    h > 0 &&
    x + w <= 1 + 1e-6 &&
    y + h <= 1 + 1e-6
    ? null
    : 'INVALID_RECT';
}

/** Returns the first problem with the request, or null when it can be generated. */
export function checkGenerateInput(input: GenerateInput): GenerateErrorCode | null {
  if (!(
    input.image.width > 0 &&
    input.image.height > 0 &&
    finite(input.image.width + input.image.height)
  )) {
    return 'INVALID_IMAGE_SIZE';
  }
  if (!(finite(input.ratio) && input.ratio > 0)) return 'INVALID_RATIO';
  if (!Number.isInteger(input.steps) || input.steps < 1 || input.steps > MAX_STEPS) {
    return 'INVALID_STEP_COUNT';
  }
  if (!unit(input.focus.x) || !unit(input.focus.y)) return 'INVALID_FOCUS';
  const issue = endpointIssue(input.start) ?? endpointIssue(input.end);
  if (issue) return issue;
  // The first frame must be tighter than the last one (checked on what is actually asked).
  if (input.steps > 1 && endpointZoom(input, input.start) <= endpointZoom(input, input.end)) {
    return 'START_NOT_TIGHTER';
  }
  return null;
}

interface ResolvedEndpoint {
  zoom: number;
  center: Point;
}

/**
 * Generates the ordered frames of a Zoom Out sequence: the first one honours
 * the initial zoom (or frame), the last one the final zoom (or frame), and the
 * ones in between follow a regular progression.
 *
 * - The zoom is interpolated geometrically, so every step feels like the same
 *   amount of "zooming out"; the center moves in a straight line between the two
 *   ends (it stays on the focus when both ends are zoom levels).
 * - A frame that would leave the image is moved the least possible, never
 *   resized; a zoom out of the allowed range is brought back to it. Both are
 *   reported in `warnings`.
 * - Pure and deterministic: the same input always gives the same frames, and
 *   nothing depends on the size the image is displayed at.
 * - With a single step, the frame is the initial one.
 */
export function generateSequence(input: GenerateInput): GenerateResult {
  const problem = checkGenerateInput(input);
  if (problem) throw new GenerateError(problem);

  const { image, ratio, focus, steps } = input;
  const limit = maxZoomFor(image, ratio);
  const raised: number[] = [];
  const limited: number[] = [];
  const reratioed: number[] = [];

  const resolve = (endpoint: Endpoint, index: number): ResolvedEndpoint => {
    let zoom = endpointZoom(input, endpoint);
    if (endpoint.kind === 'rect') {
      const aspect = (endpoint.rect.w * image.width) / (endpoint.rect.h * image.height);
      if (Math.abs(aspect / ratio - 1) > 1e-3) reratioed.push(index);
    }
    if (zoom < MIN_ZOOM) {
      raised.push(index);
      zoom = MIN_ZOOM;
    } else if (zoom > limit) {
      limited.push(index);
      zoom = limit;
    }
    return { zoom, center: endpoint.kind === 'zoom' ? focus : rectCenter(endpoint.rect) };
  };

  const start = resolve(input.start, 0);
  const end = resolve(input.end, steps - 1);

  const rects: Rect[] = [];
  const shifted: number[] = [];
  for (let i = 0; i < steps; i += 1) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    const zoom = clamp(start.zoom * Math.pow(end.zoom / start.zoom, t), MIN_ZOOM, limit);
    const center = {
      x: start.center.x + (end.center.x - start.center.x) * t,
      y: start.center.y + (end.center.y - start.center.y) * t,
    };
    const placed = placeRect(image, ratio, zoom, center);
    if (placed.shifted) shifted.push(i);
    rects.push(roundRect(placed.rect));
  }

  const warnings: GenerationWarning[] = [];
  if (raised.length > 0) warnings.push({ code: 'ZOOM_RAISED_TO_FIT', steps: raised });
  if (limited.length > 0) warnings.push({ code: 'ZOOM_LIMITED', steps: limited });
  if (reratioed.length > 0) warnings.push({ code: 'RECT_ADJUSTED_TO_RATIO', steps: reratioed });
  if (shifted.length > 0) warnings.push({ code: 'FRAME_SHIFTED_INSIDE_IMAGE', steps: shifted });
  return { rects, warnings };
}

/** A step as the editor holds it: a frame, an optional custom name, and whether it was adjusted by hand. */
export interface StepDraft {
  readonly name: string | null;
  readonly rect: Rect;
  readonly manual: boolean;
}

export interface BuildStepsResult {
  readonly steps: readonly StepDraft[];
  readonly warnings: readonly GenerationWarning[];
  /** Manually adjusted steps that did not fit in the new sequence length. */
  readonly droppedManual: number;
}

/**
 * Generates a sequence for the editor. When `preserveManual` is set, steps the
 * administrator adjusted by hand keep their frame at the same position; every
 * other step is regenerated but keeps its custom name. Without it, everything
 * is regenerated, names included. Preserved steps beyond the new length are
 * dropped and counted.
 */
export function buildSteps(
  input: GenerateInput,
  existing: readonly StepDraft[] = [],
  preserveManual = false,
): BuildStepsResult {
  const generated = generateSequence(input);
  const steps = generated.rects.map((rect, index): StepDraft => {
    const previous = existing[index];
    if (preserveManual && previous?.manual) return previous;
    return { name: preserveManual ? (previous?.name ?? null) : null, rect, manual: false };
  });
  const droppedManual = preserveManual
    ? existing.slice(input.steps).filter((step) => step.manual).length
    : 0;
  return { steps, warnings: generated.warnings, droppedManual };
}

/** Largest frame of the ratio (zoom 1), moved toward the focus as far as the image allows. */
export function fitFrame(image: ImageSize, ratio: number, focus: Point): Rect {
  return roundRect(placeRect(image, ratio, 1, focus).rect);
}
