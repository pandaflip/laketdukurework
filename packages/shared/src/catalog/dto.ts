import type { Locale } from '../i18n/locales';
import type { UniverseAudience } from '../policy/core-exclusions';
import type { EligibilityByMode } from '../policy/eligibility';
import type { ModeId } from '../registry/modes';
import type { AgeClass, CharacterStatus } from './enums';
import type { LocalizedNames } from './schemas';

/** Response shapes of the admin API. */

export interface AdminDto {
  readonly id: string;
  readonly username: string;
}

export interface UniverseDto {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly enabledModes: readonly ModeId[];
  /** `YOUTH`: associated with a young audience; sensitive modes are locked by default. */
  readonly audience: UniverseAudience;
  /** Explicit unlock of sensitive modes (only meaningful for `YOUTH` universes). */
  readonly sensitiveUnlocked: boolean;
  readonly sensitiveUnlockNote: string | null;
  readonly sensitiveUnlockedAt: string | null;
  readonly characterCount: number;
}

export interface VariantDto {
  readonly id: string;
  readonly slug: string;
  readonly names: LocalizedNames;
}

/** Individual review state of a character's images. */
export interface ImageSummaryDto {
  readonly total: number;
  readonly approvedNeutral: number;
  readonly approvedSensitive: number;
  readonly rejected: number;
  readonly unverified: number;
}

export interface CharacterDto {
  readonly id: string;
  readonly slug: string;
  readonly universe: {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
    readonly audience: UniverseAudience;
  };
  /** Minimum length of the justification of a verified-adult classification here. */
  readonly adultNoteMinLength: number;
  readonly names: LocalizedNames;
  readonly aliases: Readonly<Record<Locale, readonly string[]>>;
  readonly status: CharacterStatus;
  readonly ageClass: AgeClass;
  readonly ageClassNote: string | null;
  readonly blockedModes: readonly ModeId[];
  /** Fundamental exclusion from sensitive modes: cannot be lifted from the interface. */
  readonly coreExcluded: boolean;
  /** Computed by the server with the shared policy; never trusted from the client. */
  readonly eligibility: EligibilityByMode;
  /** Review state of the images: a separate matter from the character's eligibility. */
  readonly images: ImageSummaryDto;
  /**
   * Number of images that would make a playable challenge for each mode,
   * i.e. images individually approved for that mode of an eligible character.
   */
  readonly usableImages: Readonly<Record<ModeId, number>>;
  readonly variants: readonly VariantDto[];
  readonly updatedAt: string;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export const AUDIT_ACTIONS = [
  'universe.create',
  'universe.update',
  'universe.sensitive-unlock',
  'universe.sensitive-lock',
  'character.create',
  'character.labels',
  'character.status',
  'character.classification',
  'character.blocked-modes',
  'variant.create',
  'variant.update',
  'variant.delete',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntryDto {
  readonly id: string;
  readonly action: AuditAction;
  readonly entityType: 'universe' | 'character';
  readonly entityId: string;
  /** Display label of the entity at the time of the change. */
  readonly entityLabel: string;
  readonly adminUsername: string;
  readonly batchId: string | null;
  readonly before: unknown;
  readonly after: unknown;
  /** Set when this entry is itself the restoration of an earlier one. */
  readonly revertsId: string | null;
  readonly revertedAt: string | null;
  /** Whether the server would currently accept restoring this entry. */
  readonly restorable: boolean;
  readonly createdAt: string;
}

export interface BulkStatusResultDto {
  readonly batchId: string | null;
  readonly changed: number;
  readonly unchanged: number;
}

export interface BatchRestoreResultDto {
  readonly restored: number;
  readonly skipped: number;
}
