import { isPolicyYouthUniverse, type UniverseIdentity } from './core-exclusions';

/**
 * Audience classification of a universe, set explicitly by an administrator.
 * - GENERAL:    reviewed, not aimed at a young audience
 * - YOUTH:      aimed at a young audience; sensitive modes need an explicit unlock
 * - UNREVIEWED: nobody has looked yet (default); treated as the strictest tier
 */
export const UNIVERSE_AUDIENCES = ['GENERAL', 'YOUTH', 'UNREVIEWED'] as const;
export type UniverseAudience = (typeof UNIVERSE_AUDIENCES)[number];

/** Every new universe starts here: deny by default until somebody reviews it. */
export const DEFAULT_UNIVERSE_AUDIENCE: UniverseAudience = 'UNREVIEWED';

export interface AudienceInput extends UniverseIdentity {
  /** The classification stored for the universe. Absent means unreviewed. */
  readonly audience?: UniverseAudience;
}

/**
 * The audience that applies: universes listed in the code are young-audience
 * whatever is stored (the interface cannot relax them); every other universe
 * uses its stored classification, `UNREVIEWED` when missing.
 */
export function effectiveAudience(universe: AudienceInput): UniverseAudience {
  if (isPolicyYouthUniverse(universe)) return 'YOUTH';
  return universe.audience ?? DEFAULT_UNIVERSE_AUDIENCE;
}

/**
 * Whether sensitive modes can be enabled for this universe right now:
 * reviewed as general, or young-audience with an explicit unlock. Never for an
 * unreviewed universe.
 */
export function sensitiveModesAvailable(
  universe: AudienceInput & { readonly sensitiveUnlocked?: boolean },
): boolean {
  const audience = effectiveAudience(universe);
  return audience === 'GENERAL' || (audience === 'YOUTH' && universe.sensitiveUnlocked === true);
}
