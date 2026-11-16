import {
  normalizeName,
  SUPPORTED_LOCALES,
  TYPO_MIN_LENGTH,
  TYPO_TWO_ERRORS_LENGTH,
  type LabelKind,
  type LocalizedNames,
  type Locale,
} from '@app/shared';
import type { AnswerOptions } from './types';

export interface CatalogLabel {
  readonly characterId: string;
  readonly locale: string;
  readonly kind: LabelKind;
  readonly value: string;
  readonly normalized: string;
}

/** Number of typing mistakes tolerated on a name of this (normalized) length. */
export function allowedErrors(length: number): number {
  if (length < TYPO_MIN_LENGTH) return 0;
  return length >= TYPO_TWO_ERRORS_LENGTH ? 2 : 1;
}

/**
 * Optimal string alignment distance: insertions, deletions, substitutions
 * and swaps of two neighbouring letters ("leblacn" is one mistake from
 * "leblanc"). Gives up, returning `limit + 1`, as soon as the distance is
 * known to exceed `limit`.
 */
export function distance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const width = b.length + 1;
  let beforePrevious: number[] = [];
  let previous = Array.from({ length: width }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const row: number[] = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        (previous[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, (beforePrevious[j - 2] ?? 0) + 1);
      }
      row.push(value);
      best = Math.min(best, value);
    }
    if (best > limit) return limit + 1;
    beforePrevious = previous;
    previous = row;
  }
  return Math.min(previous[b.length] ?? limit + 1, limit + 1);
}

interface Owner {
  name: boolean;
  alias: boolean;
}

/**
 * Compares typed answers with the names and aliases of the WHOLE catalog, so
 * an answer is refused when it could mean another character: a label shared by
 * two characters is ambiguous and matches nobody, and a typo is only accepted
 * when no other name is as close.
 */
export class AnswerIndex {
  private readonly exact = new Map<string, Map<string, Owner>>();
  private readonly names: { characterId: string; normalized: string }[] = [];
  private readonly namesOf = new Map<string, string[]>();

  constructor(labels: readonly CatalogLabel[]) {
    for (const label of labels) {
      if (label.normalized === '') continue;
      let owners = this.exact.get(label.normalized);
      if (!owners) {
        owners = new Map();
        this.exact.set(label.normalized, owners);
      }
      const owner = owners.get(label.characterId) ?? { name: false, alias: false };
      if (label.kind === 'NAME') owner.name = true;
      else owner.alias = true;
      owners.set(label.characterId, owner);
      if (label.kind === 'NAME') {
        this.names.push({ characterId: label.characterId, normalized: label.normalized });
        const list = this.namesOf.get(label.characterId) ?? [];
        if (!list.includes(label.normalized)) list.push(label.normalized);
        this.namesOf.set(label.characterId, list);
      }
    }
  }

  /** Whether the character has at least one official name that points to it alone. */
  isAnswerable(characterId: string): boolean {
    return (this.namesOf.get(characterId) ?? []).some(
      (normalized) => this.exact.get(normalized)?.size === 1,
    );
  }

  matches(characterId: string, text: string, options: AnswerOptions): boolean {
    const guess = normalizeName(text);
    if (guess === '') return false;

    const owners = this.exact.get(guess);
    if (owners) {
      if (owners.size > 1) return false; // ambiguous: it could be several characters
      const owner = owners.get(characterId);
      if (!owner) return false; // exactly another character
      return owner.name || (owner.alias && options.aliases);
    }
    if (!options.typoTolerance) return false;
    const found = this.closest(characterId, guess);
    return found !== null && !this.hasRival(characterId, guess, found);
  }

  /** A name, an alias, or a typo of the expected answer, whatever the options. */
  isRelated(characterId: string, text: string): boolean {
    const guess = normalizeName(text);
    if (guess === '') return false;
    if (this.exact.get(guess)?.has(characterId)) return true;
    return this.closest(characterId, guess) !== null;
  }

  /** Distance to the closest official name of the character, if within tolerance. */
  private closest(characterId: string, guess: string): number | null {
    if (guess.length < TYPO_MIN_LENGTH) return null;
    let best: number | null = null;
    for (const name of this.namesOf.get(characterId) ?? []) {
      const limit = allowedErrors(name.length);
      if (limit === 0) continue;
      const found = distance(guess, name, limit);
      if (found <= limit && (best === null || found < best)) best = found;
    }
    return best;
  }

  /** Another character with a name at least as close to the typed answer. */
  private hasRival(characterId: string, guess: string, own: number): boolean {
    for (const other of this.names) {
      if (other.characterId === characterId) continue;
      if (distance(guess, other.normalized, own) <= own) return true;
    }
    return false;
  }
}

/** A name per language for every character the players may type, sorted. */
export function buildSuggestions(
  characters: readonly { readonly names: LocalizedNames }[],
): Record<Locale, string[]> {
  const result = {} as Record<Locale, string[]>;
  for (const locale of SUPPORTED_LOCALES) {
    const unique = new Set(
      characters.map((character) => character.names[locale] ?? character.names.en),
    );
    result[locale] = [...unique].sort((a, b) => a.localeCompare(b, locale));
  }
  return result;
}
