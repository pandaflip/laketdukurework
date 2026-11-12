import { COORD_EPSILON, MAX_ZOOM, MIN_CROP_SIDE_PX, MIN_ZOOM } from './constants';

/**
 * Frames ("rectangles") are expressed in the coordinate system of the SOURCE
 * image, normalized to 0..1, so they never depend on the size they are
 * displayed at: x, y is the top-left corner, w, h the size.
 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

export interface Aspect {
  readonly w: number;
  readonly h: number;
}

/** The display ratios offered for the game. The first one is the default. */
export const ASPECT_PRESETS: readonly Aspect[] = [
  { w: 16, h: 9 },
  { w: 4, h: 3 },
  { w: 1, h: 1 },
];
export const DEFAULT_ASPECT: Aspect = { w: 16, h: 9 };

export function isAspectPreset(aspect: Aspect): boolean {
  return ASPECT_PRESETS.some((preset) => preset.w === aspect.w && preset.h === aspect.h);
}

export const aspectRatio = (aspect: Aspect): number => aspect.w / aspect.h;

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Six decimals: far below a source pixel, and stable across engines. */
export const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

/** Pixel size of the largest frame of `ratio` that fits inside the image (zoom 1). */
export function fitSize(image: ImageSize, ratio: number): { w: number; h: number } {
  return image.width / image.height >= ratio
    ? { w: image.height * ratio, h: image.height }
    : { w: image.width, h: image.width / ratio };
}

/**
 * Highest zoom allowed for this image and ratio: the global maximum, lowered
 * so that a frame never becomes smaller than {@link MIN_CROP_SIDE_PX} pixels.
 */
export function maxZoomFor(image: ImageSize, ratio: number): number {
  const fit = fitSize(image, ratio);
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(fit.w, fit.h) / MIN_CROP_SIDE_PX));
}

export const rectCenter = (rect: Rect): Point => ({
  x: rect.x + rect.w / 2,
  y: rect.y + rect.h / 2,
});

/** Zoom of a frame: how many times smaller than the zoom-1 frame it is. */
export function zoomOfRect(image: ImageSize, ratio: number, rect: Rect): number {
  return fitSize(image, ratio).w / (rect.w * image.width);
}

/** Size (normalized) of the frame at `zoom`; the ratio is exact by construction. */
export function rectSizeAtZoom(
  image: ImageSize,
  ratio: number,
  zoom: number,
): { w: number; h: number } {
  const fit = fitSize(image, ratio);
  return { w: fit.w / zoom / image.width, h: fit.h / zoom / image.height };
}

/**
 * The frame at `zoom` centered on `center`, moved the least possible so that it
 * stays inside the image. `shifted` tells whether it had to move.
 */
export function placeRect(
  image: ImageSize,
  ratio: number,
  zoom: number,
  center: Point,
): { rect: Rect; shifted: boolean } {
  const { w, h } = rectSizeAtZoom(image, ratio, zoom);
  const wantedX = center.x - w / 2;
  const wantedY = center.y - h / 2;
  const x = clamp(wantedX, 0, 1 - w);
  const y = clamp(wantedY, 0, 1 - h);
  return {
    rect: { x, y, w, h },
    shifted: Math.abs(x - wantedX) > 1e-9 || Math.abs(y - wantedY) > 1e-9,
  };
}

/** Rounds to six decimals and keeps the frame inside the image. */
export function roundRect(rect: Rect): Rect {
  const w = round6(rect.w);
  const h = round6(rect.h);
  return {
    x: clamp(round6(rect.x), 0, Math.max(0, 1 - w)),
    y: clamp(round6(rect.y), 0, Math.max(0, 1 - h)),
    w,
    h,
  };
}

/** Moves a frame by a normalized offset, never out of the image. */
export function moveRect(rect: Rect, dx: number, dy: number): Rect {
  return roundRect({
    ...rect,
    x: clamp(rect.x + dx, 0, 1 - rect.w),
    y: clamp(rect.y + dy, 0, 1 - rect.h),
  });
}

/**
 * Changes the zoom of a frame around its own center, inside the image and
 * within the allowed zoom range. The ratio is preserved.
 */
export function zoomRect(image: ImageSize, ratio: number, rect: Rect, zoom: number): Rect {
  const limited = clamp(zoom, MIN_ZOOM, maxZoomFor(image, ratio));
  return roundRect(placeRect(image, ratio, limited, rectCenter(rect)).rect);
}

/** Moves the center of a frame to `center` (clamped), keeping its size. */
export function centerRect(rect: Rect, center: Point): Rect {
  return moveRect(rect, center.x - rect.w / 2 - rect.x, center.y - rect.h / 2 - rect.y);
}

export const withinUnit = (value: number): boolean =>
  value >= -COORD_EPSILON && value <= 1 + COORD_EPSILON;
