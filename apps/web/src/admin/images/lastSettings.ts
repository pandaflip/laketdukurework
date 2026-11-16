import {
  DEFAULT_ASPECT,
  DEFAULT_STEPS,
  DEFAULT_ZOOM_END,
  DEFAULT_ZOOM_START,
  isAspectPreset,
  MAX_STEPS,
  MAX_ZOOM,
  MIN_ZOOM,
  type Aspect,
} from '@app/shared';

/** Simple-mode settings offered again for the next image. The focus point is never part of them. */
export interface SequenceSettings {
  readonly steps: number;
  readonly zoomStart: number;
  readonly zoomEnd: number;
  readonly aspect: Aspect;
}

export const DEFAULT_SETTINGS: SequenceSettings = {
  steps: DEFAULT_STEPS,
  zoomStart: DEFAULT_ZOOM_START,
  zoomEnd: DEFAULT_ZOOM_END,
  aspect: DEFAULT_ASPECT,
};

const STORAGE_KEY = 'app.sequence.lastSettings';

const inRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

/** Reads the last settings; anything missing, damaged or unavailable gives `undefined`. */
export function readLastSettings(): SequenceSettings | undefined {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return undefined;
    const value = JSON.parse(raw) as Record<string, unknown>;
    const aspect = value.aspect as Aspect | undefined;
    if (
      Number.isInteger(value.steps) &&
      inRange(value.steps, 1, MAX_STEPS) &&
      inRange(value.zoomStart, MIN_ZOOM, MAX_ZOOM) &&
      inRange(value.zoomEnd, MIN_ZOOM, MAX_ZOOM) &&
      aspect !== undefined &&
      isAspectPreset(aspect)
    ) {
      return { steps: value.steps, zoomStart: value.zoomStart, zoomEnd: value.zoomEnd, aspect };
    }
  } catch {
    // Storage unavailable or corrupted: simply no remembered settings.
  }
  return undefined;
}

export function rememberSettings(settings: SequenceSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Nothing to do: the next image just starts from the defaults.
  }
}
