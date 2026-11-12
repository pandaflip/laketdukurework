import { z } from 'zod';
import type { IneligibilityReason } from '../policy/eligibility';
import {
  isAspectPreset,
  MAX_STEP_NAME_LENGTH,
  MAX_STEPS,
  MAX_ZOOM,
  MIN_ZOOM,
  type Aspect,
  type Rect,
} from '../sequence';
import { ASSET_REVIEWS, type AssetReview } from './enums';
import type { LocalizedNames } from './schemas';

/** Files kept for an image. `original` is the normalized source; the other two are derived. */
export const IMAGE_FILE_KINDS = ['thumb', 'display', 'original'] as const;
export type ImageFileKind = (typeof IMAGE_FILE_KINDS)[number];

/** The only mode with a sequence editor for now. The model already holds a mode per sequence. */
export const SEQUENCE_MODE = 'zoom-out';

/** Identifiers are generated (letters, digits, dash, underscore): nothing else is accepted. */
const id = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const rectSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

export const aspectSchema = z
  .object({ w: z.number().int(), h: z.number().int() })
  .refine(isAspectPreset);

/** The simple-mode settings the sequence was generated from; kept to reopen the editor. */
export const sequenceParamsSchema = z.object({
  focus: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  steps: z.number().int().min(1).max(MAX_STEPS),
  zoomStart: z.number().min(MIN_ZOOM).max(MAX_ZOOM),
  zoomEnd: z.number().min(MIN_ZOOM).max(MAX_ZOOM),
});
export type SequenceParams = z.infer<typeof sequenceParamsSchema>;

export const stepInputSchema = z.object({
  name: z.string().trim().max(MAX_STEP_NAME_LENGTH).nullable(),
  rect: rectSchema,
  manual: z.boolean(),
});
export type StepInput = z.infer<typeof stepInputSchema>;

/**
 * The whole sequence is saved at once. The server re-checks every frame
 * (bounds, ratio, size, count): the browser's checks are never trusted.
 */
export const saveSequenceSchema = z.object({
  aspect: aspectSchema,
  params: sequenceParamsSchema,
  steps: z.array(stepInputSchema).min(1).max(MAX_STEPS),
});
export type SaveSequenceRequest = z.infer<typeof saveSequenceSchema>;

/**
 * Approving for sensitive modes also requires `confirm: true` and a written
 * justification; the server re-evaluates every eligibility condition.
 */
export const reviewImageSchema = z.object({
  review: z.enum(ASSET_REVIEWS),
  note: z.string().trim().max(1000).default(''),
  confirm: z.boolean().optional(),
});
export type ReviewImageRequest = z.infer<typeof reviewImageSchema>;

export const SENSITIVE_APPROVAL_NOTE_MIN_LENGTH = 20;

export const imageListQuerySchema = z.object({
  characterId: id.optional(),
  review: z.enum(ASSET_REVIEWS).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});
export type ImageListQuery = z.infer<typeof imageListQuerySchema>;

export const imageFileParamsSchema = z.object({ id, kind: z.enum(IMAGE_FILE_KINDS) });

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export interface ImageDto {
  readonly id: string;
  readonly characterId: string;
  readonly characterNames: LocalizedNames;
  readonly universeName: string;
  /** Display label taken from the file name (sanitized). Never used as a path. */
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly sourceFormat: string;
  readonly review: AssetReview;
  readonly reviewedAt: string | null;
  readonly hasSequence: boolean;
  readonly stepCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StepDto {
  readonly name: string | null;
  readonly rect: Rect;
  readonly manual: boolean;
}

export interface SequenceDto {
  readonly modeId: typeof SEQUENCE_MODE;
  readonly aspect: Aspect;
  readonly params: SequenceParams;
  readonly steps: readonly StepDto[];
  readonly updatedAt: string;
}

export type ApprovalBlocker = IneligibilityReason | 'SEQUENCE_REQUIRED';

export interface ApprovalCheckDto {
  readonly allowed: boolean;
  readonly blockers: readonly ApprovalBlocker[];
}

export interface ImageDetailDto extends ImageDto {
  readonly sequence: SequenceDto | null;
  /** What the server would accept right now, with the reasons when it would not. */
  readonly approval: { readonly neutral: ApprovalCheckDto; readonly sensitive: ApprovalCheckDto };
  /** The next image still to review, in list order. */
  readonly nextId: string | null;
}

export interface PrunedFilesDto {
  readonly orphans: number;
  readonly removed: number;
}
