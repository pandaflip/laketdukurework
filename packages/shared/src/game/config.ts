import { z } from 'zod';
import { SLUG_PATTERN } from '../text/normalize';
import { FINAL_HOLD_MIN_SEC } from './limits';

/** Technical identifiers only, short lists: a filter never carries free text. */
const slugList = z.array(z.string().max(64).regex(SLUG_PATTERN)).max(50);

export const contentFilterSchema = z.strictObject({
  universes: slugList.default([]),
  excludeUniverses: slugList.default([]),
  include: slugList.default([]),
  require: slugList.default([]),
  exclude: slugList.default([]),
});

export const ATTEMPT_MODES = ['unlimited', 'perStep', 'limited'] as const;
export const VOTE_THRESHOLDS = ['half', 'threeQuarters', 'unanimous'] as const;
export type VoteThreshold = (typeof VOTE_THRESHOLDS)[number];

export const CONFIG_LIMITS = {
  targetScore: { min: 1_000, max: 50_000, default: 5_000 },
  steps: { min: 3, max: 20, default: 10 },
  stepDelaySec: { min: 2, max: 15, default: 6 },
  cooldownSec: { min: 1, max: 10, default: 2 },
  maxAttempts: { min: 1, max: 15, default: 5 },
} as const;

const integerIn = (limits: { min: number; max: number }) =>
  z.number().int().min(limits.min).max(limits.max);

export const attemptsSchema = z.discriminatedUnion('kind', [
  /** As many answers as wanted, at least `cooldownSec` seconds apart. */
  z.strictObject({
    kind: z.literal('unlimited'),
    cooldownSec: integerIn(CONFIG_LIMITS.cooldownSec).default(CONFIG_LIMITS.cooldownSec.default),
  }),
  /** One answer per step: the allowance is renewed at every new step. */
  z.strictObject({ kind: z.literal('perStep') }),
  /** At most `max` answers in the whole round. */
  z.strictObject({
    kind: z.literal('limited'),
    max: integerIn(CONFIG_LIMITS.maxAttempts).default(CONFIG_LIMITS.maxAttempts.default),
  }),
]);

/**
 * How the game is played. `multiplayer` is the only rule set for now: steps
 * appear on a shared timer, points reward the order of the right answers and
 * players may vote to skip ahead. Solo variants (manual steps with points per
 * clue used, timed solo) will be further profiles with their own options;
 * nothing else in a configuration or in the engine assumes several players.
 */
export const PLAY_PROFILES = ['multiplayer'] as const;
export type PlayProfile = (typeof PLAY_PROFILES)[number];

export const roomConfigSchema = z.strictObject({
  /** Zoom Out is the only playable mode in this version. */
  modeId: z.literal('zoom-out').default('zoom-out'),
  profile: z.literal('multiplayer').default('multiplayer'),
  targetScore: integerIn(CONFIG_LIMITS.targetScore).default(CONFIG_LIMITS.targetScore.default),
  steps: integerIn(CONFIG_LIMITS.steps).default(CONFIG_LIMITS.steps.default),
  stepDelaySec: integerIn(CONFIG_LIMITS.stepDelaySec).default(CONFIG_LIMITS.stepDelaySec.default),
  attempts: attemptsSchema.default({ kind: 'unlimited', cooldownSec: 2 }),
  vote: z
    .strictObject({
      enabled: z.boolean().default(true),
      threshold: z.enum(VOTE_THRESHOLDS).default('half'),
    })
    .default({ enabled: true, threshold: 'half' }),
  typoTolerance: z.boolean().default(true),
  aliases: z.boolean().default(true),
  showWrongAnswers: z.boolean().default(false),
  filter: contentFilterSchema.default({
    universes: [],
    excludeUniverses: [],
    include: [],
    require: [],
    exclude: [],
  }),
});

export type RoomConfig = z.output<typeof roomConfigSchema>;
export type AttemptsConfig = RoomConfig['attempts'];

export const DEFAULT_ROOM_CONFIG: RoomConfig = roomConfigSchema.parse({});

export type ConfigResult =
  { readonly ok: true; readonly config: RoomConfig } | { readonly ok: false };

/** Validates a configuration from the network: unknown fields and out-of-range values are refused. */
export function parseRoomConfig(input: unknown): ConfigResult {
  const parsed = roomConfigSchema.safeParse(input);
  return parsed.success ? { ok: true, config: parsed.data } : { ok: false };
}

export const CONFIG_PRESETS = ['fast', 'normal', 'relaxed'] as const;
export type ConfigPreset = (typeof CONFIG_PRESETS)[number];

/** Presets fill the pace options only; the other options are left untouched. */
export const PRESET_VALUES: Readonly<
  Record<ConfigPreset, { readonly steps: number; readonly stepDelaySec: number }>
> = {
  fast: { steps: 8, stepDelaySec: 4 },
  normal: { steps: 10, stepDelaySec: 6 },
  relaxed: { steps: 15, stepDelaySec: 8 },
};

export function applyPreset(config: RoomConfig, preset: ConfigPreset): RoomConfig {
  return { ...config, ...PRESET_VALUES[preset] };
}

/** Seconds the last step stays on screen before the round ends. */
export function finalHoldSec(stepDelaySec: number): number {
  return Math.max(stepDelaySec, FINAL_HOLD_MIN_SEC);
}

/**
 * Normal duration of a round: the first step appears at once, so there are
 * `steps - 1` delays, then the final hold. Votes can only shorten it.
 */
export function estimateRoundSec(stepCount: number, stepDelaySec: number): number {
  return Math.max(0, stepCount - 1) * stepDelaySec + finalHoldSec(stepDelaySec);
}
