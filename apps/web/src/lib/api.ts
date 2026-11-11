import {
  apiErrorSchema,
  healthResponseSchema,
  type AdminDto,
  type AuditEntryDto,
  type BatchRestoreResultDto,
  type BulkCharacterStatusRequest,
  type BulkStatusResultDto,
  type CharacterDto,
  type CharacterStatus,
  type CreateCharacterRequest,
  type CreateUniverseRequest,
  type ErrorCode,
  type HealthResponse,
  type LoginRequest,
  type ModeId,
  type Page,
  type SetClassificationRequest,
  type UniverseDto,
  type UpdateCharacterLabelsRequest,
  type UpdateUniverseRequest,
  type VariantRequest,
} from '@app/shared';

export type ClientErrorCode = ErrorCode | 'NETWORK_ERROR';

/** Carries only a stable code; the interface translates it (`errors` namespace). */
export class ApiError extends Error {
  constructor(readonly code: ClientErrorCode) {
    super(code);
    this.name = 'ApiError';
  }
}

export function errorCodeOf(error: unknown): ClientErrorCode {
  return error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
}

/** All API calls are same-origin (`/api/...`) and send the session cookie. */
async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${url}`, {
      method,
      credentials: 'same-origin',
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError('NETWORK_ERROR');
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    throw new ApiError(parsed.success ? parsed.data.error.code : 'INTERNAL_ERROR');
  }
  return payload as T;
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch('/api/health', signal ? { signal } : {});
  // A 503 still carries a valid body describing which part is down.
  return healthResponseSchema.parse(await response.json());
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

export interface CharacterFilters {
  search?: string;
  universeId?: string;
  status?: CharacterStatus | '';
  page?: number;
}

export const adminApi = {
  me: () => request<{ admin: AdminDto }>('GET', '/admin/auth/me'),
  login: (body: LoginRequest) => request<{ admin: AdminDto }>('POST', '/admin/auth/login', body),
  logout: () => request<{ ok: true }>('POST', '/admin/auth/logout', {}),

  universes: () => request<UniverseDto[]>('GET', '/admin/universes'),
  createUniverse: (body: CreateUniverseRequest) =>
    request<UniverseDto>('POST', '/admin/universes', body),
  updateUniverse: (id: string, body: UpdateUniverseRequest) =>
    request<UniverseDto>('PUT', `/admin/universes/${id}`, body),

  characters: (filters: CharacterFilters) =>
    request<Page<CharacterDto>>('GET', `/admin/characters${query({ ...filters })}`),
  character: (id: string) => request<CharacterDto>('GET', `/admin/characters/${id}`),
  createCharacter: (body: CreateCharacterRequest) =>
    request<CharacterDto>('POST', '/admin/characters', body),
  updateLabels: (id: string, body: UpdateCharacterLabelsRequest) =>
    request<CharacterDto>('PUT', `/admin/characters/${id}/labels`, body),
  setStatus: (id: string, status: CharacterStatus) =>
    request<CharacterDto>('PUT', `/admin/characters/${id}/status`, { status }),
  bulkStatus: (body: BulkCharacterStatusRequest) =>
    request<BulkStatusResultDto>('POST', '/admin/characters/bulk-status', body),
  setClassification: (id: string, body: SetClassificationRequest) =>
    request<CharacterDto>('PUT', `/admin/characters/${id}/classification`, body),
  setBlockedModes: (id: string, modeIds: ModeId[]) =>
    request<CharacterDto>('PUT', `/admin/characters/${id}/blocked-modes`, { modeIds }),

  createVariant: (characterId: string, body: VariantRequest) =>
    request<CharacterDto>('POST', `/admin/characters/${characterId}/variants`, body),
  updateVariant: (id: string, body: VariantRequest) =>
    request<CharacterDto>('PUT', `/admin/variants/${id}`, body),
  deleteVariant: (id: string) => request<CharacterDto>('DELETE', `/admin/variants/${id}`),

  audit: (params: { entityId?: string; page?: number }) =>
    request<Page<AuditEntryDto>>('GET', `/admin/audit${query(params)}`),
  restore: (id: string) => request<{ ok: true }>('POST', `/admin/audit/${id}/restore`, {}),
  restoreBatch: (batchId: string) =>
    request<BatchRestoreResultDto>('POST', `/admin/audit/batches/${batchId}/restore`, {}),
};
