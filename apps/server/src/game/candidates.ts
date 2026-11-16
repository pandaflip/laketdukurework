import {
  aspectRatio,
  challengeEligibility,
  checkSteps,
  normalizeName,
  type LocalizedNames,
  type ModeId,
  type Rect,
} from '@app/shared';
import type { Db } from '../db';
import { eligibilityInputs } from '../modules/catalog/characters.service';
import { buildSuggestions, type CatalogLabel } from './answers';

/** One image that could be played: everything the game needs to know about it, and nothing else. */
export interface Candidate {
  readonly assetId: string;
  readonly characterId: string;
  readonly universeSlug: string;
  readonly universeName: string;
  /**
   * Categories of the character. The category tables arrive with the rooms
   * (Phase 2B); until then this is always empty, so a category filter simply
   * matches nothing.
   */
  readonly categorySlugs: readonly string[];
  readonly names: LocalizedNames;
  readonly storageKey: string;
  readonly width: number;
  readonly height: number;
  /** Every saved frame, in order. */
  readonly rects: readonly Rect[];
}

const APPROVED = ['APPROVED_NEUTRAL', 'APPROVED_SENSITIVE'] as const;

function namesOf(
  labels: readonly { locale: string; kind: string; value: string }[],
  fallback: string,
): LocalizedNames {
  const pick = (locale: string): string | undefined =>
    labels.find((label) => label.kind === 'NAME' && label.locale === locale)?.value;
  const english = pick('en') ?? labels.find((label) => label.kind === 'NAME')?.value ?? fallback;
  const french = pick('fr');
  const portuguese = pick('pt-BR');
  return {
    en: english,
    ...(french === undefined ? {} : { fr: french }),
    ...(portuguese === undefined ? {} : { 'pt-BR': portuguese }),
  };
}

/**
 * The images that may be played in `modeId` RIGHT NOW, read from the stored
 * data without any cache: the character and universe rules, the individual
 * approval of the image, and frames that are still valid for the picture.
 *
 * With `assetId`, only that image is evaluated (used again just before its
 * round, since an administrator may have changed anything since the draw).
 */
export async function loadCandidates(
  db: Db,
  modeId: ModeId,
  assetId?: string,
): Promise<Candidate[]> {
  // One query after the other on purpose, as elsewhere: no parallel relation loading.
  const assets = await db.asset.findMany({
    where: {
      ...(assetId === undefined ? {} : { id: assetId }),
      review: { in: [...APPROVED] },
      sequences: { some: { modeId, steps: { some: {} } } },
    },
    include: {
      sequences: {
        where: { modeId },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: 1,
        include: { steps: { orderBy: { position: 'asc' } } },
      },
    },
    orderBy: { id: 'asc' },
  });
  if (assets.length === 0) return [];

  const characters = await db.character.findMany({
    where: { id: { in: [...new Set(assets.map((asset) => asset.characterId))] } },
    include: { universe: true, labels: true, blockedModes: true },
  });
  const byId = new Map(characters.map((character) => [character.id, character]));

  const candidates: Candidate[] = [];
  for (const asset of assets) {
    const character = byId.get(asset.characterId);
    const sequence = asset.sequences[0];
    if (!character || !sequence) continue;

    const { universe, character: input } = eligibilityInputs(character);
    if (!challengeEligibility(modeId, universe, input, { review: asset.review }).eligible) continue;

    const rects: Rect[] = sequence.steps.map((step) => ({
      x: step.x,
      y: step.y,
      w: step.w,
      h: step.h,
    }));
    const frames = checkSteps(
      rects.map((rect) => ({ name: null, rect })),
      { width: asset.width, height: asset.height },
      aspectRatio({ w: sequence.aspectW, h: sequence.aspectH }),
    );
    if (!frames.ok) continue;

    candidates.push({
      assetId: asset.id,
      characterId: character.id,
      universeSlug: character.universe.slug,
      universeName: character.universe.name,
      categorySlugs: [],
      names: namesOf(character.labels, character.slug),
      storageKey: asset.storageKey,
      width: asset.width,
      height: asset.height,
      rects,
    });
  }
  return candidates;
}

export interface GameCatalog {
  /** Every label of every character: ambiguity is judged against the whole catalog. */
  readonly labels: readonly CatalogLabel[];
  /** What players may type, by language. Independent from the challenges drawn. */
  readonly suggestions: ReturnType<typeof buildSuggestions>;
}

/** Names and aliases of the whole catalog, for answer matching and autocompletion. */
export async function loadCatalog(db: Db): Promise<GameCatalog> {
  const characters = await db.character.findMany({
    select: {
      id: true,
      slug: true,
      status: true,
      labels: { select: { locale: true, kind: true, value: true, normalized: true } },
    },
    orderBy: { id: 'asc' },
  });
  const labels: CatalogLabel[] = [];
  for (const character of characters) {
    for (const label of character.labels) {
      labels.push({
        characterId: character.id,
        locale: label.locale,
        kind: label.kind,
        value: label.value,
        // Same normalization as the stored one, in case the stored value predates a change.
        normalized: normalizeName(label.value),
      });
    }
  }
  const visible = characters
    .filter((character) => character.status !== 'EXCLUDED')
    .map((character) => ({ names: namesOf(character.labels, character.slug) }));
  return { labels, suggestions: buildSuggestions(visible) };
}
