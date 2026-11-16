/**
 * Which of the `available` saved steps of an image are played when the host
 * asked for `requested` steps. The first and the last saved step are always
 * kept and the others are spread evenly; no frame is ever invented, so an
 * image with fewer steps than requested simply plays all of them.
 *
 * Pure and deterministic: the result only depends on the two numbers.
 */
export function selectStepIndices(available: number, requested: number): number[] {
  if (!Number.isInteger(available) || available < 1) return [];
  const wanted = Number.isInteger(requested) ? Math.max(1, requested) : 1;
  if (wanted >= available) return Array.from({ length: available }, (_, index) => index);
  if (wanted === 1) return [0];
  // The distance between two kept steps is above 1 here, so rounding cannot
  // make two of them collide.
  return Array.from({ length: wanted }, (_, index) =>
    Math.round((index * (available - 1)) / (wanted - 1)),
  );
}
