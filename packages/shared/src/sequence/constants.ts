/**
 * Technical limits of the Zoom Out sequence editor. They protect the server
 * and keep frames usable; none of them is a business rule about how many steps
 * a good sequence has.
 */
export const MAX_STEPS = 100;
export const DEFAULT_STEPS = 5;

/** Zoom 1 is the largest frame of the chosen ratio that fits in the image. */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 20;
export const DEFAULT_ZOOM_START = 6;
export const DEFAULT_ZOOM_END = 1;

/** The shorter side of a frame never goes below this many source pixels. */
export const MIN_CROP_SIDE_PX = 24;

export const MAX_STEP_NAME_LENGTH = 80;

/** Relative tolerance on a frame's width/height ratio (rounding of saved values). */
export const RATIO_TOLERANCE = 1e-3;
/** Absolute tolerance on normalized coordinates. */
export const COORD_EPSILON = 1e-6;
