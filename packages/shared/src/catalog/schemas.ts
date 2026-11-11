import { z } from 'zod';
import { MODE_IDS } from '../registry/modes';
import { SLUG_PATTERN } from '../text/normalize';
import { AGE_CLASSES, CHARACTER_STATUSES } from './enums';

/**
 * Request schemas of the admin API. The server validates every request with
 * them; the web app reuses them for types and client-side checks.
 */

const displayName = z.string().trim().min(1).max(80);
const slug = z.string().trim().min(1).max(64).regex(SLUG_PATTERN);
const id = z.string().min(1).max(64);

/** One display name per language. English is required and is the reference. */
export const localizedNamesSchema = z.object({
  en: displayName,
  fr: displayName.optional(),
  'pt-BR': displayName.optional(),
});
export type LocalizedNames = z.infer<typeof localizedNamesSchema>;

/** Extra accepted spellings per language (used later to validate answers). */
const aliasList = z.array(displayName).max(20);
export const localizedAliasesSchema = z.object({
  en: aliasList.optional(),
  fr: aliasList.optional(),
  'pt-BR': aliasList.optional(),
});
export type LocalizedAliases = z.infer<typeof localizedAliasesSchema>;

export const modeIdSchema = z.enum(MODE_IDS);
export const characterStatusSchema = z.enum(CHARACTER_STATUSES);
export const ageClassSchema = z.enum(AGE_CLASSES);

export const loginRequestSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const createUniverseSchema = z.object({
  slug: slug.optional(),
  name: displayName,
  enabledModes: z.array(modeIdSchema).max(MODE_IDS.length),
});
export type CreateUniverseRequest = z.infer<typeof createUniverseSchema>;

export const updateUniverseSchema = z.object({
  name: displayName,
  enabledModes: z.array(modeIdSchema).max(MODE_IDS.length),
});
export type UpdateUniverseRequest = z.infer<typeof updateUniverseSchema>;

/**
 * A new character always starts RESTRICTED and UNKNOWN: neither the status
 * nor the classification can be chosen at creation.
 */
export const createCharacterSchema = z.object({
  universeId: id,
  slug: slug.optional(),
  names: localizedNamesSchema,
  aliases: localizedAliasesSchema.optional(),
});
export type CreateCharacterRequest = z.infer<typeof createCharacterSchema>;

export const updateCharacterLabelsSchema = z.object({
  names: localizedNamesSchema,
  aliases: localizedAliasesSchema,
});
export type UpdateCharacterLabelsRequest = z.infer<typeof updateCharacterLabelsSchema>;

export const setCharacterStatusSchema = z.object({ status: characterStatusSchema });
export type SetCharacterStatusRequest = z.infer<typeof setCharacterStatusSchema>;

export const BULK_STATUS_MAX = 200;

/** Bulk edits only ever touch the status: the classification is never bulk-editable. */
export const bulkCharacterStatusSchema = z.object({
  ids: z.array(id).min(1).max(BULK_STATUS_MAX),
  status: characterStatusSchema,
});
export type BulkCharacterStatusRequest = z.infer<typeof bulkCharacterStatusSchema>;

export const ADULT_NOTE_MIN_LENGTH = 20;

/**
 * `ADULT_VERIFIED` additionally requires `confirm: true` and a written
 * justification of at least {@link ADULT_NOTE_MIN_LENGTH} characters
 * (enforced by the server).
 */
export const setClassificationSchema = z.object({
  ageClass: ageClassSchema,
  note: z.string().trim().max(1000),
  confirm: z.boolean().optional(),
});
export type SetClassificationRequest = z.infer<typeof setClassificationSchema>;

export const setBlockedModesSchema = z.object({
  modeIds: z.array(modeIdSchema).max(MODE_IDS.length),
});
export type SetBlockedModesRequest = z.infer<typeof setBlockedModesSchema>;

export const variantSchema = z.object({
  slug: slug.optional(),
  names: localizedNamesSchema,
});
export type VariantRequest = z.infer<typeof variantSchema>;

export const characterListQuerySchema = z.object({
  search: z.string().trim().max(80).optional(),
  universeId: id.optional(),
  status: characterStatusSchema.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type CharacterListQuery = z.infer<typeof characterListQuerySchema>;

export const auditListQuerySchema = z.object({
  entityId: id.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type AuditListQuery = z.infer<typeof auditListQuerySchema>;
