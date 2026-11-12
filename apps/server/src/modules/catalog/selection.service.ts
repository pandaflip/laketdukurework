import { challengeEligibility, type EligibilityResult, type ModeId } from '@app/shared';
import type { Db } from '../../db';
import { AppError, notFound } from '../../errors';
import { eligibilityInputs, loadRow } from './characters.service';

/**
 * Whether one image may be used in one round of one mode, evaluated NOW from
 * the stored data (no cache): the administrable status, the safety
 * classification, the universe settings, the per-mode restrictions, the
 * fundamental exclusions and the individual approval of THIS image.
 *
 * `modeId` must be the concrete mode of the round. For Chaos Mix, each round
 * is checked under the mode it was drawn for; the composite mode itself is
 * refused.
 */
export async function checkRoundEligibility(
  db: Db,
  modeId: ModeId,
  assetId: string,
): Promise<EligibilityResult> {
  const asset = await db.asset.findUnique({
    where: { id: assetId },
    include: { variant: { select: { characterId: true } } },
  });
  if (!asset) throw notFound();

  const row = await loadRow(db, asset.variant.characterId);
  const { universe, character } = eligibilityInputs(row);
  return challengeEligibility(modeId, universe, character, { review: asset.review });
}

/** Throws unless the round is allowed. Used by the game engine before every round (Phase 2). */
export async function assertRoundEligible(db: Db, modeId: ModeId, assetId: string): Promise<void> {
  const result = await checkRoundEligibility(db, modeId, assetId);
  if (!result.eligible) throw new AppError(422, 'INELIGIBLE_CONTENT');
}
