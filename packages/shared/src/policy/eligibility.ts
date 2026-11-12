import type { AgeClass, AssetReview, CharacterStatus } from '../catalog/enums';
import { isCompositeMode, MODES, MODE_IDS, type ModeId } from '../registry/modes';
import { effectiveAudience, type UniverseAudience } from './audience';
import { isCoreExcludedCharacter } from './core-exclusions';

/**
 * Single source of truth for "may this character (or challenge) appear in this
 * mode?". Pure and deterministic: the server calls it when selecting
 * challenges and when publishing; the admin interface only displays its result.
 *
 * Deny by default: a sensitive mode requires EVERY condition below, and no
 * single administrable setting (status, variant, alias, universe option) can
 * make up for a missing one.
 */

export const INELIGIBILITY_REASONS = [
  'MODE_IS_COMPOSITE',
  'CHARACTER_EXCLUDED',
  'MODE_DISABLED_FOR_UNIVERSE',
  'MODE_BLOCKED_FOR_CHARACTER',
  'UNIVERSE_UNREVIEWED',
  'UNIVERSE_SENSITIVE_LOCKED',
  'CORE_EXCLUSION',
  'STATUS_RESTRICTED',
  'NOT_ADULT_VERIFIED',
  'ASSET_NOT_APPROVED',
  'ASSET_REJECTED',
] as const;

export type IneligibilityReason = (typeof INELIGIBILITY_REASONS)[number];

export interface EligibilityResult {
  readonly eligible: boolean;
  readonly reasons: readonly IneligibilityReason[];
}

export interface EligibilityUniverse {
  readonly slug: string;
  readonly name?: string;
  readonly enabledModes: readonly string[];
  /** The stored audience classification; absent means unreviewed. */
  readonly audience?: UniverseAudience;
  /**
   * Whether an administrator explicitly unlocked sensitive modes. Only
   * consulted for young-audience universes; absent means locked.
   */
  readonly sensitiveUnlocked?: boolean;
}

export interface EligibilityCharacter {
  readonly slug: string;
  /** Every name and alias, in every language. */
  readonly labels: readonly string[];
  readonly status: CharacterStatus;
  readonly ageClass: AgeClass;
  readonly blockedModes: readonly string[];
}

export interface EligibilityAsset {
  readonly review: AssetReview;
}

function result(reasons: IneligibilityReason[]): EligibilityResult {
  return { eligible: reasons.length === 0, reasons };
}

function characterReasons(
  modeId: ModeId,
  universe: EligibilityUniverse,
  character: EligibilityCharacter,
): IneligibilityReason[] {
  // A composite mode (Chaos Mix) is never a valid round mode: every round is
  // checked under the concrete mode it was drawn for.
  if (isCompositeMode(modeId)) return ['MODE_IS_COMPOSITE'];

  const reasons: IneligibilityReason[] = [];
  const sensitive = MODES[modeId].sensitivity !== 'neutral';

  // Anything that is not explicitly an active status is treated as excluded.
  const active = character.status === 'ALLOWED' || character.status === 'RESTRICTED';
  if (!active) reasons.push('CHARACTER_EXCLUDED');
  if (!universe.enabledModes.includes(modeId)) reasons.push('MODE_DISABLED_FOR_UNIVERSE');
  if (character.blockedModes.includes(modeId)) reasons.push('MODE_BLOCKED_FOR_CHARACTER');

  if (sensitive) {
    const audience = effectiveAudience(universe);
    if (audience === 'UNREVIEWED') reasons.push('UNIVERSE_UNREVIEWED');
    else if (audience === 'YOUTH' && universe.sensitiveUnlocked !== true) {
      reasons.push('UNIVERSE_SENSITIVE_LOCKED');
    }
    if (isCoreExcludedCharacter(universe, character)) reasons.push('CORE_EXCLUSION');
    if (active && character.status !== 'ALLOWED') reasons.push('STATUS_RESTRICTED');
    if (character.ageClass !== 'ADULT_VERIFIED') reasons.push('NOT_ADULT_VERIFIED');
  }
  return reasons;
}

/** Character-level eligibility: necessary, but not sufficient, for a challenge. */
export function characterEligibility(
  modeId: ModeId,
  universe: EligibilityUniverse,
  character: EligibilityCharacter,
): EligibilityResult {
  return result(characterReasons(modeId, universe, character));
}

/**
 * Full eligibility of a challenge: the character rules plus an individually
 * approved asset. A sensitive mode requires an asset explicitly approved for
 * sensitive use; unverified content is excluded from every mode.
 */
export function challengeEligibility(
  modeId: ModeId,
  universe: EligibilityUniverse,
  character: EligibilityCharacter,
  asset: EligibilityAsset,
): EligibilityResult {
  const reasons = characterReasons(modeId, universe, character);
  if (isCompositeMode(modeId)) return result(reasons);
  const sensitive = MODES[modeId].sensitivity !== 'neutral';

  if (asset.review === 'REJECTED') {
    reasons.push('ASSET_REJECTED');
  } else if (sensitive) {
    if (asset.review !== 'APPROVED_SENSITIVE') reasons.push('ASSET_NOT_APPROVED');
  } else if (asset.review !== 'APPROVED_NEUTRAL' && asset.review !== 'APPROVED_SENSITIVE') {
    reasons.push('ASSET_NOT_APPROVED');
  }
  return result(reasons);
}

export type EligibilityByMode = Readonly<Record<ModeId, EligibilityResult>>;

export function characterEligibilityByMode(
  universe: EligibilityUniverse,
  character: EligibilityCharacter,
): EligibilityByMode {
  return Object.fromEntries(
    MODE_IDS.map((modeId) => [modeId, characterEligibility(modeId, universe, character)]),
  ) as Record<ModeId, EligibilityResult>;
}

/**
 * Whether `ADULT_VERIFIED` may be recorded at all for this character. The
 * server refuses the classification otherwise, so the database never holds a
 * misleading "verified adult" flag on a fundamentally excluded character.
 */
export function canBeClassifiedAdult(
  universe: EligibilityUniverse,
  character: Pick<EligibilityCharacter, 'slug' | 'labels'>,
): boolean {
  return !isCoreExcludedCharacter(universe, character);
}
