/**
 * Game modes: technical metadata only.
 *
 * Identifiers are stable, language-independent and used in the database, the
 * API and network events. Display names and descriptions live in the `modes`
 * translation namespace, keyed by these identifiers, and may differ per locale.
 */
export const MODE_IDS = [
  'zoom-out',
  'pixelated',
  'shadow-guess',
  'skin-detective',
  'historic',
  'chaos-mix',
] as const;

export type ModeId = (typeof MODE_IDS)[number];

/**
 * `sensitive` modes are opt-in, disabled by default, and subject to the strict
 * character/asset eligibility policy enforced by the server.
 */
export type ModeSensitivity = 'neutral' | 'sensitive';

export interface ModeDefinition {
  readonly id: ModeId;
  readonly sensitivity: ModeSensitivity;
}

export const MODES: Readonly<Record<ModeId, ModeDefinition>> = {
  'zoom-out': { id: 'zoom-out', sensitivity: 'neutral' },
  pixelated: { id: 'pixelated', sensitivity: 'neutral' },
  'shadow-guess': { id: 'shadow-guess', sensitivity: 'neutral' },
  'skin-detective': { id: 'skin-detective', sensitivity: 'neutral' },
  historic: { id: 'historic', sensitivity: 'sensitive' },
  'chaos-mix': { id: 'chaos-mix', sensitivity: 'neutral' },
};

export function isModeId(value: unknown): value is ModeId {
  return typeof value === 'string' && (MODE_IDS as readonly string[]).includes(value);
}
