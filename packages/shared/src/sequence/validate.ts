import {
  COORD_EPSILON,
  MAX_STEP_NAME_LENGTH,
  MAX_STEPS,
  MIN_CROP_SIDE_PX,
  RATIO_TOLERANCE,
} from './constants';
import { withinUnit, type ImageSize, type Rect } from './geometry';

export type StepIssueCode =
  'NOT_FINITE' | 'OUT_OF_BOUNDS' | 'WRONG_RATIO' | 'TOO_SMALL' | 'NAME_TOO_LONG';

export interface StepIssue {
  readonly index: number;
  readonly code: StepIssueCode;
}

/** The first problem with one frame, or null when it is valid for this image and ratio. */
export function checkRect(rect: Rect, image: ImageSize, ratio: number): StepIssueCode | null {
  const values = [rect.x, rect.y, rect.w, rect.h];
  if (!values.every(Number.isFinite) || rect.w <= 0 || rect.h <= 0) return 'NOT_FINITE';
  if (
    !withinUnit(rect.x) ||
    !withinUnit(rect.y) ||
    rect.x + rect.w > 1 + COORD_EPSILON ||
    rect.y + rect.h > 1 + COORD_EPSILON
  ) {
    return 'OUT_OF_BOUNDS';
  }
  const pixelRatio = (rect.w * image.width) / (rect.h * image.height);
  if (Math.abs(pixelRatio / ratio - 1) > RATIO_TOLERANCE) return 'WRONG_RATIO';
  if (Math.min(rect.w * image.width, rect.h * image.height) < MIN_CROP_SIDE_PX * 0.999) {
    return 'TOO_SMALL';
  }
  return null;
}

export interface StepsCheck {
  readonly ok: boolean;
  readonly issues: readonly StepIssue[];
  /** Zero steps, or more than the technical limit. */
  readonly badCount: boolean;
}

/** Checks a whole list of steps. Used by the server on every save, whatever the browser did. */
export function checkSteps(
  steps: readonly { readonly name: string | null; readonly rect: Rect }[],
  image: ImageSize,
  ratio: number,
): StepsCheck {
  const issues: StepIssue[] = [];
  steps.forEach((step, index) => {
    const issue = checkRect(step.rect, image, ratio);
    if (issue) issues.push({ index, code: issue });
    else if (step.name !== null && step.name.length > MAX_STEP_NAME_LENGTH) {
      issues.push({ index, code: 'NAME_TOO_LONG' });
    }
  });
  const badCount = steps.length < 1 || steps.length > MAX_STEPS;
  return { ok: issues.length === 0 && !badCount, issues, badCount };
}
