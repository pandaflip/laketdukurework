import { buildSteps, type BuildStepsResult, type GenerateInput } from './generate';
import { clamp, round6, type Point } from './geometry';

/**
 * Random mode: draw a focus point automatically, then generate the sequence
 * with the ordinary generator. There is no detection of any kind; the draw
 * is kept inside a central zone to avoid borders and empty margins, which is
 * all this version does to pick a good spot.
 */

/** Fraction of the width and of the height (centered) in which the focus is drawn. */
export const DEFAULT_RANDOM_ZONE = 0.6;
export const MIN_RANDOM_ZONE = 0.2;
export const MAX_RANDOM_ZONE = 1;

export const DEFAULT_RANDOM_ZOOM_START = 12;
export const DEFAULT_RANDOM_ZOOM_END = 1;

/** A source of numbers in [0, 1), like `Math.random`. Injected so draws can be tested. */
export type Random = () => number;

/** A small seedable generator (mulberry32) for tests and reproducible draws. */
export function createRng(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clampZone(zone: number): number {
  return Number.isFinite(zone)
    ? clamp(zone, MIN_RANDOM_ZONE, MAX_RANDOM_ZONE)
    : DEFAULT_RANDOM_ZONE;
}

/**
 * A focus point drawn uniformly in the central `zone` of the picture
 * (0.6 = the middle 60% in both directions). Always inside the picture.
 */
export function randomFocus(random: Random, zone: number = DEFAULT_RANDOM_ZONE): Point {
  const size = clampZone(zone);
  const margin = (1 - size) / 2;
  const draw = (): number => {
    const value = random();
    // A misbehaving source (NaN, out of range) can never push the focus out of the zone.
    return round6(margin + (Number.isFinite(value) ? clamp(value, 0, 1) : 0.5) * size);
  };
  const x = draw();
  const y = draw();
  return { x, y };
}

export interface RandomSequenceInput extends Omit<GenerateInput, 'focus'> {
  readonly zone?: number;
}

export interface RandomSequenceResult extends BuildStepsResult {
  readonly focus: Point;
}

/**
 * Draws a focus and generates the sequence for it with the existing
 * generator (same frames, same corrections and warnings). Nothing here is
 * stored: the result is saved like any other sequence, and once saved it stays
 * as it is: no game ever draws again.
 */
export function generateRandomSequence(
  input: RandomSequenceInput,
  random: Random,
): RandomSequenceResult {
  const { zone, ...request } = input;
  const focus = randomFocus(random, zone);
  return { focus, ...buildSteps({ ...request, focus }) };
}
