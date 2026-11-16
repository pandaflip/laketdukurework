import { createHash } from 'node:crypto';
import sharp, { type Sharp } from 'sharp';

/** Why an upload was refused. Reported to the client as a single stable code. */
export type ImageRejection = 'UNSUPPORTED' | 'CORRUPT' | 'ANIMATED' | 'TOO_BIG' | 'TOO_SMALL';

export class ImageRejected extends Error {
  constructor(readonly reason: ImageRejection) {
    super(reason);
    this.name = 'ImageRejected';
  }
}

export interface ImageLimits {
  readonly maxPixels: number;
  readonly minSide: number;
}

export interface ProcessedImage {
  readonly sha256: string;
  readonly sourceFormat: 'jpeg' | 'png' | 'webp';
  /** Size after applying the orientation of the file. */
  readonly width: number;
  readonly height: number;
  readonly original: Buffer;
  readonly display: Buffer;
  readonly thumb: Buffer;
}

const ACCEPTED_FORMATS = ['jpeg', 'png', 'webp'] as const;
const DISPLAY_MAX_SIDE = 1600;
const THUMB_MAX_SIDE = 320;

export const sha256Of = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** Runs at most `max` tasks at the same time; the others wait their turn, in order. */
export function createLimiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (task) => {
    if (active >= max) {
      await new Promise<void>((resolve) => waiting.push(resolve)); // the slot is handed over
    } else {
      active += 1;
    }
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

/**
 * Validates an upload by decoding it (the declared type and the file name are
 * never trusted) and produces the three stored versions.
 *
 * - Only static JPEG, PNG and WebP are accepted: no SVG, GIF, AVIF, TIFF, PDF...
 * - The decode is bounded by `maxPixels`, so a decompression bomb is refused
 *   before it allocates memory.
 * - Orientation is applied and every other piece of metadata (EXIF, GPS, ICC,
 *   XMP, comments) is dropped: sharp writes none unless asked to.
 * - The original is stored losslessly (fast encoding: see below), the derived versions are
 *   lossy and small.
 */
export async function processUpload(bytes: Buffer, limits: ImageLimits): Promise<ProcessedImage> {
  const options = { limitInputPixels: limits.maxPixels, failOn: 'error' as const };
  let format: string | undefined;
  try {
    const meta = await sharp(bytes, options).metadata();
    format = meta.format;
    if (!meta.width || !meta.height) throw new ImageRejected('CORRUPT');
    if (!(ACCEPTED_FORMATS as readonly string[]).includes(format)) {
      throw new ImageRejected('UNSUPPORTED');
    }
    if ((meta.pages ?? 1) > 1) throw new ImageRejected('ANIMATED');
    if (meta.width * meta.height > limits.maxPixels) throw new ImageRejected('TOO_BIG');
    if (Math.min(meta.width, meta.height) < limits.minSide) throw new ImageRejected('TOO_SMALL');

    const oriented = (): Sharp => sharp(bytes, options).rotate();
    const [original, display, thumb] = await Promise.all([
      // Effort 0: about eight times faster than the default for a file roughly a quarter larger,
      // which does not matter for administrators' originals but does for importing in a row.
      oriented().webp({ lossless: true, effort: 0 }).toBuffer({ resolveWithObject: true }),
      oriented()
        .resize({
          width: DISPLAY_MAX_SIDE,
          height: DISPLAY_MAX_SIDE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toBuffer(),
      oriented()
        .resize({
          width: THUMB_MAX_SIDE,
          height: THUMB_MAX_SIDE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 75 })
        .toBuffer(),
    ]);

    return {
      sha256: sha256Of(bytes),
      sourceFormat: format as ProcessedImage['sourceFormat'],
      width: original.info.width,
      height: original.info.height,
      original: original.data,
      display,
      thumb,
    };
  } catch (error) {
    if (error instanceof ImageRejected) throw error;
    const message = error instanceof Error ? error.message : '';
    if (/pixel limit/i.test(message)) throw new ImageRejected('TOO_BIG');
    // Anything else sharp refuses to decode: not an image, truncated, damaged.
    throw new ImageRejected(format === undefined ? 'UNSUPPORTED' : 'CORRUPT');
  }
}

/** A short display label from a client-supplied file name. Never used as a path. */
export function labelFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const label = base
    .replace(/\.[^.]*$/, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return label === '' ? 'image' : label;
}
