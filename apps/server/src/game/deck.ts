/** Pseudo-random numbers in [0, 1): injected so tests can replay a draw. */
export type Random = () => number;

/** Fisher-Yates shuffle into a new array. */
export function shuffled<T>(items: readonly T[], random: Random): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.min(index, Math.floor(random() * (index + 1)));
    const kept = result[index] as T;
    result[index] = result[other] as T;
    result[other] = kept;
  }
  return result;
}

/**
 * The order in which the challenges of a game are tried: random, and never
 * twice the same image or the same character.
 */
export function drawOrder<T extends { readonly assetId: string; readonly characterId: string }>(
  candidates: readonly T[],
  random: Random,
): T[] {
  const assets = new Set<string>();
  const characters = new Set<string>();
  const order: T[] = [];
  for (const candidate of shuffled(candidates, random)) {
    if (assets.has(candidate.assetId) || characters.has(candidate.characterId)) continue;
    assets.add(candidate.assetId);
    characters.add(candidate.characterId);
    order.push(candidate);
  }
  return order;
}
