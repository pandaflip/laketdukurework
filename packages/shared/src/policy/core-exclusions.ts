import { normalizeName } from '../text/normalize';

/**
 * FUNDAMENTAL SAFETY RULES. Not editable from the admin interface.
 *
 * Changing this file requires a reviewed code change. Entries can be added
 * freely; removing one must never happen without an explicit product decision.
 */

/**
 * Universes that never offer sensitive modes, whatever their configuration.
 * Matched on the normalized slug and name.
 */
const NEVER_SENSITIVE_UNIVERSES: readonly string[] = ['pokemon', 'minecraft'];

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

export function isNeverSensitiveUniverse(universe: UniverseIdentity): boolean {
  const keys = identityKeys(universe.slug, [universe.name]);
  return NEVER_SENSITIVE_UNIVERSES.some((entry) => keys.has(entry));
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
