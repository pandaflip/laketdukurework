import {
  ADULT_NOTE_MIN_LENGTH,
  canBeClassifiedAdult,
  characterEligibility,
  characterEligibilityByMode,
  isCoreExcludedCharacter,
  localizedNamesSchema,
  normalizeName,
  slugify,
  SUPPORTED_LOCALES,
  type AgeClass,
  type BulkStatusResultDto,
  type CharacterDto,
  type CharacterListQuery,
  type CharacterStatus,
  type CreateCharacterRequest,
  type EligibilityCharacter,
  type EligibilityUniverse,
  type LabelKind,
  type Locale,
  type LocalizedAliases,
  type LocalizedNames,
  type ModeId,
  type Page,
  type SetClassificationRequest,
  type VariantDto,
  type VariantRequest,
} from '@app/shared';
import { randomUUID } from 'node:crypto';
import { isUniqueViolation, type Db, type DbOrTx } from '../../db';
import { AppError, conflict, invalid, notFound } from '../../errors';
import type { Prisma } from '../../generated/prisma/client';
import { canonical, writeAudit, type AuditContext } from '../audit/log';
import { knownModes } from './universes.service';

const include = {
  universe: true,
  labels: true,
  blockedModes: true,
  variants: { orderBy: { slug: 'asc' } },
} satisfies Prisma.CharacterInclude;

type Row = Prisma.CharacterGetPayload<{ include: typeof include }>;

// ---------------------------------------------------------------------------
// Facets: the independently editable (and restorable) parts of a character.
// ---------------------------------------------------------------------------

export interface LabelsFacet {
  readonly names: LocalizedNames;
  readonly aliases: Record<Locale, string[]>;
}
export interface StatusFacet {
  readonly status: CharacterStatus;
}
export interface ClassificationFacet {
  readonly ageClass: AgeClass;
  readonly note: string | null;
}
export interface BlockedModesFacet {
  readonly modeIds: ModeId[];
}

function labelsFacet(row: Row): LabelsFacet {
  const nameOf = (locale: Locale): string | undefined =>
    row.labels.find((label) => label.kind === 'NAME' && label.locale === locale)?.value;
  const aliasesOf = (locale: Locale): string[] =>
    row.labels
      .filter((label) => label.kind === 'ALIAS' && label.locale === locale)
      .map((label) => label.value)
      .sort((a, b) => a.localeCompare(b));

  const fr = nameOf('fr');
  const ptBR = nameOf('pt-BR');
  return {
    names: {
      en: nameOf('en') ?? row.slug,
      ...(fr === undefined ? {} : { fr }),
      ...(ptBR === undefined ? {} : { 'pt-BR': ptBR }),
    },
    aliases: { en: aliasesOf('en'), fr: aliasesOf('fr'), 'pt-BR': aliasesOf('pt-BR') },
  };
}

const statusFacet = (row: Row): StatusFacet => ({ status: row.status });
const classificationFacet = (row: Row): ClassificationFacet => ({
  ageClass: row.ageClass,
  note: row.ageClassNote,
});
const blockedModesFacet = (row: Row): BlockedModesFacet => ({
  modeIds: knownModes(row.blockedModes.map((entry) => entry.modeId)),
});

function assertExpected(expected: unknown, current: unknown): void {
  if (expected !== undefined && canonical(expected) !== canonical(current)) {
    throw new AppError(409, 'RESTORE_CONFLICT');
  }
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function eligibilityInputs(row: Row): {
  universe: EligibilityUniverse;
  character: EligibilityCharacter;
} {
  return {
    universe: {
      slug: row.universe.slug,
      name: row.universe.name,
      enabledModes: row.universe.enabledModes,
    },
    character: {
      slug: row.slug,
      labels: row.labels.map((label) => label.value),
      status: row.status,
      ageClass: row.ageClass,
      blockedModes: row.blockedModes.map((entry) => entry.modeId),
    },
  };
}

function toVariantDto(variant: { id: string; slug: string; names: unknown }): VariantDto {
  const names = localizedNamesSchema.safeParse(variant.names);
  return {
    id: variant.id,
    slug: variant.slug,
    names: names.success ? names.data : { en: variant.slug },
  };
}

function toDto(row: Row): CharacterDto {
  const { universe, character } = eligibilityInputs(row);
  const labels = labelsFacet(row);
  return {
    id: row.id,
    slug: row.slug,
    universe: { id: row.universe.id, slug: row.universe.slug, name: row.universe.name },
    names: labels.names,
    aliases: labels.aliases,
    status: row.status,
    ageClass: row.ageClass,
    ageClassNote: row.ageClassNote,
    blockedModes: blockedModesFacet(row).modeIds,
    coreExcluded: isCoreExcludedCharacter(universe, character),
    eligibility: characterEligibilityByMode(universe, character),
    variants: row.variants.map(toVariantDto),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadRow(db: DbOrTx, id: string): Promise<Row> {
  const row = await db.character.findUnique({ where: { id }, include });
  if (!row) throw notFound();
  return row;
}

interface LabelRow {
  locale: Locale;
  kind: LabelKind;
  value: string;
  normalized: string;
}

/** One NAME per language plus de-duplicated aliases. Unusable labels are rejected. */
function buildLabelRows(names: LocalizedNames, aliases: LocalizedAliases = {}): LabelRow[] {
  const rows: LabelRow[] = [];
  for (const locale of SUPPORTED_LOCALES) {
    const seen = new Set<string>();
    const add = (kind: LabelKind, value: string): void => {
      const normalized = normalizeName(value);
      if (normalized === '') throw invalid();
      if (seen.has(normalized)) return;
      seen.add(normalized);
      rows.push({ locale, kind, value, normalized });
    };
    const name = names[locale];
    if (name !== undefined) add('NAME', name);
    for (const alias of aliases[locale] ?? []) add('ALIAS', alias);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listCharacters(
  db: Db,
  query: CharacterListQuery,
): Promise<Page<CharacterDto>> {
  const needle = query.search === undefined ? '' : normalizeName(query.search);
  const slugNeedle = query.search === undefined ? '' : slugify(query.search);
  const search: Prisma.CharacterWhereInput[] = [];
  if (needle !== '') search.push({ labels: { some: { normalized: { contains: needle } } } });
  if (slugNeedle !== '') search.push({ slug: { contains: slugNeedle } });

  const where: Prisma.CharacterWhereInput = {
    ...(query.universeId === undefined ? {} : { universeId: query.universeId }),
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(search.length === 0 ? {} : { OR: search }),
    // A search made only of punctuation matches nothing rather than everything.
    ...(query.search !== undefined && query.search !== '' && search.length === 0
      ? { id: '__no_match__' }
      : {}),
  };

  const [total, rows] = await Promise.all([
    db.character.count({ where }),
    db.character.findMany({
      where,
      include,
      orderBy: [{ slug: 'asc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { items: rows.map(toDto), total, page: query.page, pageSize: query.pageSize };
}

export async function getCharacter(db: DbOrTx, id: string): Promise<CharacterDto> {
  return toDto(await loadRow(db, id));
}

/**
 * Server-side eligibility query, independent from any interface filter.
 * Challenge selection (lot 1C and the game engine) builds on it and adds the
 * per-asset approval check.
 */
export async function findEligibleCharacters(
  db: Db,
  modeId: ModeId,
  universeIds?: readonly string[],
): Promise<CharacterDto[]> {
  const rows = await db.character.findMany({
    where: universeIds === undefined ? {} : { universeId: { in: [...universeIds] } },
    include,
    orderBy: [{ slug: 'asc' }, { id: 'asc' }],
  });
  return rows
    .filter((row) => {
      const { universe, character } = eligibilityInputs(row);
      return characterEligibility(modeId, universe, character).eligible;
    })
    .map(toDto);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createCharacter(
  db: Db,
  context: AuditContext,
  input: CreateCharacterRequest,
): Promise<CharacterDto> {
  const slug = input.slug ?? slugify(input.names.en);
  if (slug === '') throw invalid();
  const labels = buildLabelRows(input.names, input.aliases);

  try {
    return await db.$transaction(async (tx) => {
      const universe = await tx.universe.findUnique({ where: { id: input.universeId } });
      if (!universe) throw notFound();

      // Status and classification are never taken from the request:
      // the database defaults (RESTRICTED, UNKNOWN) always apply.
      const created = await tx.character.create({
        data: { universeId: universe.id, slug, labels: { create: labels } },
      });
      const row = await loadRow(tx, created.id);
      await writeAudit(tx, context, {
        action: 'character.create',
        entityType: 'character',
        entityId: row.id,
        entityLabel: input.names.en,
        after: { slug, universe: universe.slug, ...labelsFacet(row) },
      });
      return toDto(row);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict();
    throw error;
  }
}

export async function updateLabels(
  db: Db,
  context: AuditContext,
  id: string,
  input: { names: LocalizedNames; aliases: LocalizedAliases },
  expected?: LabelsFacet,
): Promise<CharacterDto> {
  const labels = buildLabelRows(input.names, input.aliases);
  return db.$transaction(async (tx) => {
    const current = await loadRow(tx, id);
    const before = labelsFacet(current);
    assertExpected(expected, before);

    await tx.characterLabel.deleteMany({ where: { characterId: id } });
    await tx.characterLabel.createMany({
      data: labels.map((label) => ({ ...label, characterId: id })),
    });
    const row = await loadRow(tx, id);
    const after = labelsFacet(row);
    if (canonical(before) !== canonical(after)) {
      await writeAudit(tx, context, {
        action: 'character.labels',
        entityType: 'character',
        entityId: id,
        entityLabel: after.names.en,
        before: { ...before },
        after: { ...after },
      });
    }
    return toDto(row);
  });
}

async function applyStatus(
  tx: Prisma.TransactionClient,
  context: AuditContext,
  id: string,
  status: CharacterStatus,
  expected?: StatusFacet,
): Promise<boolean> {
  const current = await loadRow(tx, id);
  assertExpected(expected, statusFacet(current));
  if (current.status === status) return false;

  await tx.character.update({ where: { id }, data: { status } });
  await writeAudit(tx, context, {
    action: 'character.status',
    entityType: 'character',
    entityId: id,
    entityLabel: labelsFacet(current).names.en,
    before: { status: current.status },
    after: { status },
  });
  return true;
}

/**
 * Changes the administrable status only. It cannot make a character eligible
 * to a sensitive mode: the classification and fundamental exclusions are
 * evaluated separately, every time eligibility is computed.
 */
export async function setStatus(
  db: Db,
  context: AuditContext,
  id: string,
  status: CharacterStatus,
  expected?: StatusFacet,
): Promise<CharacterDto> {
  return db.$transaction(async (tx) => {
    await applyStatus(tx, context, id, status, expected);
    return toDto(await loadRow(tx, id));
  });
}

export async function bulkSetStatus(
  db: Db,
  context: AuditContext,
  ids: readonly string[],
  status: CharacterStatus,
): Promise<BulkStatusResultDto> {
  const uniqueIds = [...new Set(ids)];
  const batchId = randomUUID();
  return db.$transaction(async (tx) => {
    const existing = await tx.character.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true },
    });
    if (existing.length !== uniqueIds.length) throw notFound();

    let changed = 0;
    for (const { id } of existing) {
      if (await applyStatus(tx, { ...context, batchId }, id, status)) changed += 1;
    }
    return {
      batchId: changed === 0 ? null : batchId,
      changed,
      unchanged: uniqueIds.length - changed,
    };
  });
}

/**
 * Records the safety classification. `ADULT_VERIFIED` is deliberately hard to
 * set: one character at a time, explicit confirmation, written justification,
 * and never for a fundamentally excluded character.
 */
export async function setClassification(
  db: Db,
  context: AuditContext,
  id: string,
  input: SetClassificationRequest,
  expected?: ClassificationFacet,
): Promise<CharacterDto> {
  return db.$transaction(async (tx) => {
    const current = await loadRow(tx, id);
    const before = classificationFacet(current);
    assertExpected(expected, before);

    if (input.ageClass === 'ADULT_VERIFIED') {
      const { universe, character } = eligibilityInputs(current);
      if (!canBeClassifiedAdult(universe, character)) {
        throw new AppError(422, 'CLASSIFICATION_FORBIDDEN');
      }
      if (input.confirm !== true) throw new AppError(422, 'CONFIRMATION_REQUIRED');
      if (input.note.length < ADULT_NOTE_MIN_LENGTH) {
        throw new AppError(422, 'JUSTIFICATION_REQUIRED');
      }
    }

    const after: ClassificationFacet = {
      ageClass: input.ageClass,
      note: input.note === '' ? null : input.note,
    };
    if (canonical(before) === canonical(after)) return toDto(current);

    await tx.character.update({
      where: { id },
      data: {
        ageClass: after.ageClass,
        ageClassNote: after.note,
        ageClassSetAt: new Date(),
        ageClassSetById: context.adminId,
      },
    });
    await writeAudit(tx, context, {
      action: 'character.classification',
      entityType: 'character',
      entityId: id,
      entityLabel: labelsFacet(current).names.en,
      before: { ...before },
      after: { ...after },
    });
    return toDto(await loadRow(tx, id));
  });
}

export async function setBlockedModes(
  db: Db,
  context: AuditContext,
  id: string,
  modeIds: readonly ModeId[],
  expected?: BlockedModesFacet,
): Promise<CharacterDto> {
  return db.$transaction(async (tx) => {
    const current = await loadRow(tx, id);
    const before = blockedModesFacet(current);
    assertExpected(expected, before);
    const after: BlockedModesFacet = { modeIds: knownModes(modeIds) };
    if (canonical(before) === canonical(after)) return toDto(current);

    await tx.characterBlockedMode.deleteMany({ where: { characterId: id } });
    await tx.characterBlockedMode.createMany({
      data: after.modeIds.map((modeId) => ({ characterId: id, modeId })),
    });
    await writeAudit(tx, context, {
      action: 'character.blocked-modes',
      entityType: 'character',
      entityId: id,
      entityLabel: labelsFacet(current).names.en,
      before: { ...before },
      after: { ...after },
    });
    return toDto(await loadRow(tx, id));
  });
}

// ---------------------------------------------------------------------------
// Variants (skins). They carry no safety rule of their own.
// ---------------------------------------------------------------------------

export async function createVariant(
  db: Db,
  context: AuditContext,
  characterId: string,
  input: VariantRequest,
): Promise<CharacterDto> {
  const slug = input.slug ?? slugify(input.names.en);
  if (slug === '') throw invalid();
  try {
    return await db.$transaction(async (tx) => {
      const character = await loadRow(tx, characterId);
      const variant = await tx.variant.create({
        data: { characterId, slug, names: input.names },
      });
      await writeAudit(tx, context, {
        action: 'variant.create',
        entityType: 'character',
        entityId: characterId,
        entityLabel: labelsFacet(character).names.en,
        after: { variantId: variant.id, slug, names: input.names },
      });
      return toDto(await loadRow(tx, characterId));
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict();
    throw error;
  }
}

export async function updateVariant(
  db: Db,
  context: AuditContext,
  variantId: string,
  input: VariantRequest,
): Promise<CharacterDto> {
  return db.$transaction(async (tx) => {
    const variant = await tx.variant.findUnique({ where: { id: variantId } });
    if (!variant) throw notFound();
    const character = await loadRow(tx, variant.characterId);
    const before = toVariantDto(variant).names;
    if (canonical(before) !== canonical(input.names)) {
      await tx.variant.update({ where: { id: variantId }, data: { names: input.names } });
      await writeAudit(tx, context, {
        action: 'variant.update',
        entityType: 'character',
        entityId: character.id,
        entityLabel: labelsFacet(character).names.en,
        before: { variantId, slug: variant.slug, names: before },
        after: { variantId, slug: variant.slug, names: input.names },
      });
    }
    return toDto(await loadRow(tx, character.id));
  });
}

export async function deleteVariant(
  db: Db,
  context: AuditContext,
  variantId: string,
): Promise<CharacterDto> {
  return db.$transaction(async (tx) => {
    const variant = await tx.variant.findUnique({ where: { id: variantId } });
    if (!variant) throw notFound();
    const character = await loadRow(tx, variant.characterId);
    await tx.variant.delete({ where: { id: variantId } });
    await writeAudit(tx, context, {
      action: 'variant.delete',
      entityType: 'character',
      entityId: character.id,
      entityLabel: labelsFacet(character).names.en,
      before: { variantId, slug: variant.slug, names: toVariantDto(variant).names },
    });
    return toDto(await loadRow(tx, character.id));
  });
}
