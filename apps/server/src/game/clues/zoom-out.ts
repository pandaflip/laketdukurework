import type { Rect } from '@app/shared';
import sharp from 'sharp';
import type { FileStorage } from '../../modules/images/storage';
import type { ClueSource, RenderedClue } from '../types';

/** Frames are sent at most this wide: enough to see, never the stored original. */
export const CLUE_MAX_WIDTH = 960;
const CLUE_QUALITY = 80;

export interface ZoomOutClueInput {
  readonly storage: FileStorage;
  readonly storageKey: string;
  /** Size of the stored original, in pixels. */
  readonly width: number;
  readonly height: number;
  /** The frames to play, in order, as normalized rectangles of the original. */
  readonly rects: readonly Rect[];
  /** Runs `task` within the server's image concurrency budget. */
  readonly limit: <T>(task: () => Promise<T>) => Promise<T>;
}

/** Pixel rectangle of a normalized frame, always inside the picture and at least 1 pixel. */
export function pixelRect(
  rect: Rect,
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } {
  const left = Math.min(width - 1, Math.max(0, Math.round(rect.x * width)));
  const top = Math.min(height - 1, Math.max(0, Math.round(rect.y * height)));
  return {
    left,
    top,
    width: Math.max(1, Math.min(width - left, Math.round(rect.w * width))),
    height: Math.max(1, Math.min(height - top, Math.round(rect.h * height))),
  };
}

/**
 * The Zoom Out way of showing clues: each clue is a frame cut from the
 * ORIGINAL picture (the reduced version would be blurred at high zoom),
 * re-encoded without any metadata. Frames are rendered here, on the server, so
 * a player only ever holds the frames already revealed. Every frame is
 * prepared in memory ahead of its reveal to keep the pace, and stays here.
 */
export class ZoomOutClues implements ClueSource {
  private source: Promise<Buffer> | null = null;
  private readonly frames = new Map<number, Promise<RenderedClue>>();
  private released = false;

  constructor(private readonly input: ZoomOutClueInput) {}

  get count(): number {
    return this.input.rects.length;
  }

  private original(): Promise<Buffer> {
    this.source ??= this.input.storage.read('original', this.input.storageKey);
    return this.source;
  }

  render(index: number): Promise<RenderedClue> {
    if (this.released) return Promise.reject(new Error('clues released'));
    const rect = this.input.rects[index];
    if (rect === undefined) return Promise.reject(new Error('no such clue'));
    let frame = this.frames.get(index);
    if (!frame) {
      frame = this.input.limit(async () => {
        const area = pixelRect(rect, this.input.width, this.input.height);
        let pipeline = sharp(await this.original()).extract(area);
        if (area.width > CLUE_MAX_WIDTH) pipeline = pipeline.resize({ width: CLUE_MAX_WIDTH });
        const bytes = await pipeline.webp({ quality: CLUE_QUALITY, effort: 2 }).toBuffer();
        return { bytes, contentType: 'image/webp' as const };
      });
      this.frames.set(index, frame);
      // A failure is reported to whoever awaits the frame, never as an unhandled rejection.
      frame.catch(() => undefined);
    }
    return frame;
  }

  /** Starts rendering every frame after the first, one at a time, in reveal order. */
  prefetch(): void {
    void (async () => {
      for (let index = 1; index < this.count && !this.released; index++) {
        await this.render(index).catch(() => undefined);
      }
    })();
  }

  async renderReveal(): Promise<RenderedClue> {
    if (this.released) throw new Error('clues released');
    const bytes = await this.input.limit(() =>
      this.input.storage.read('display', this.input.storageKey),
    );
    return { bytes, contentType: 'image/webp' };
  }

  release(): void {
    this.released = true;
    this.frames.clear();
    this.source = null;
  }
}
