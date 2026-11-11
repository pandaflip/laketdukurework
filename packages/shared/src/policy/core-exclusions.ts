import { normalizeName } from '../text/normalize';

/**
 * FUNDAMENTAL SAFETY RULES. Not editable from the admin interface.
 *
 * Changing this file requires a reviewed code change. Entries can be added
 * freely; removing one must never happen without an explicit product decision.
 */

/**
 * Universes associated with a young audience. Sensitive modes stay locked
 * there until an administrator performs an explicit, justified and logged
 * unlock (see `sensitiveUnlocked`). The unlock is only one of the conditions:
 * every character must still be an individually verified adult with an
 * approved image. Matched on the normalized slug and name.
 */
const YOUTH_AUDIENCE_UNIVERSES: readonly string[] = ['pokemon', 'minecraft'];

export type UniverseAudience = 'GENERAL' | 'YOUTH';

/**
 * Characters that can never be eligible to sensitive modes, whatever their
 * status or classification. Matched on the normalized slug and on every name
 * and alias in every language, so a rename, a variant or an alias cannot
 * bypass the rule.
 */
const CORE_EXCLUDED_CHARACTERS: readonly {
  readonly universes: readonly string[];
  readonly names: readonly string[];
}[] = [
  {
    universes: ['leagueoflegends', 'lol', 'league'],
    names: ['annie', 'zoe'],
  },
];

export interface UniverseIdentity {
  readonly slug: string;
  readonly name?: string;
}

export interface CharacterIdentity {
  readonly slug: string;
  /** Every name and alias, in every language. */
  readonly labels: readonly string[];
}

function identityKeys(slug: string, others: readonly (string | undefined)[]): Set<string> {
  const keys = new Set<string>([normalizeName(slug)]);
  for (const other of others) if (other !== undefined) keys.add(normalizeName(other));
  keys.delete('');
  return keys;
}

export function universeAudience(universe: UniverseIdentity): UniverseAudience {
  const keys = identityKeys(universe.slug, [universe.name]);
  return YOUTH_AUDIENCE_UNIVERSES.some((entry) => keys.has(entry)) ? 'YOUTH' : 'GENERAL';
}

export function isCoreExcludedCharacter(
  universe: UniverseIdentity,
  character: CharacterIdentity,
): boolean {
  const universeKeys = identityKeys(universe.slug, [universe.name]);
  const characterKeys = identityKeys(character.slug, character.labels);
  return CORE_EXCLUDED_CHARACTERS.some(
    (entry) =>
      entry.universes.some((key) => universeKeys.has(key)) &&
      entry.names.some((key) => characterKeys.has(key)),
  );
}
