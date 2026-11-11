import {
  CHARACTER_STATUSES,
  MODE_IDS,
  MODES,
  type CharacterDto,
  type CharacterStatus,
} from '@app/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useDeferredValue, useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Checkbox,
  Field,
  Input,
  Notice,
  Select,
} from '../design/ui';
import { adminApi } from '../lib/api';
import { ErrorNotice, localizedName, ReasonList, useAdminMutation } from './shared';

const SENSITIVE_MODES = MODE_IDS.filter((id) => MODES[id].sensitivity !== 'neutral');
const NEUTRAL_MODES = MODE_IDS.filter((id) => MODES[id].sensitivity === 'neutral');

/** Effective eligibility, as computed by the server: the status alone says little. */
export function EligibilitySummary({ character }: { character: CharacterDto }) {
  const { t } = useTranslation('admin');
  const neutral = NEUTRAL_MODES.some((id) => character.eligibility[id].eligible);
  const sensitiveReasons = [
    ...new Set(SENSITIVE_MODES.flatMap((id) => character.eligibility[id].reasons)),
  ];
  const sensitive = SENSITIVE_MODES.some((id) => character.eligibility[id].eligible);

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        <Badge tone={neutral ? 'success' : 'danger'}>
          {t(neutral ? 'eligibility.neutralYes' : 'eligibility.neutralNo')}
        </Badge>
        <Badge tone={sensitive ? 'warning' : 'neutral'}>
          {t(sensitive ? 'eligibility.sensitiveYes' : 'eligibility.sensitiveNo')}
        </Badge>
      </div>
      {!sensitive && <ReasonList reasons={sensitiveReasons} />}
    </div>
  );
}

function CreateCharacterForm() {
  const { t } = useTranslation('admin');
  const universes = useQuery({ queryKey: ['admin', 'universes'], queryFn: adminApi.universes });
  const [universeId, setUniverseId] = useState('');
  const [en, setEn] = useState('');
  const [fr, setFr] = useState('');
  const [ptBR, setPtBR] = useState('');
  const create = useAdminMutation(adminApi.createCharacter, () => {
    setEn('');
    setFr('');
    setPtBR('');
  });

  const selectedUniverse = universeId === '' ? (universes.data?.[0]?.id ?? '') : universeId;
  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    create.mutate({
      universeId: selectedUniverse,
      names: {
        en,
        ...(fr.trim() === '' ? {} : { fr }),
        ...(ptBR.trim() === '' ? {} : { 'pt-BR': ptBR }),
      },
    });
  };

  return (
    <Card>
      <CardTitle>{t('characters.addTitle')}</CardTitle>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
        <Field label={t('fields.universe')}>
          <Select
            name="universeId"
            required
            value={selectedUniverse}
            onChange={(event) => {
              setUniverseId(event.target.value);
            }}
          >
            {universes.data?.map((universe) => (
              <option key={universe.id} value={universe.id}>
                {universe.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('fields.nameEn')}>
          <Input
            name="name-en"
            required
            maxLength={80}
            value={en}
            onChange={(event) => {
              setEn(event.target.value);
            }}
          />
        </Field>
        <Field label={t('fields.nameFr')}>
          <Input
            name="name-fr"
            maxLength={80}
            value={fr}
            onChange={(event) => {
              setFr(event.target.value);
            }}
          />
        </Field>
        <Field label={t('fields.namePtBR')}>
          <Input
            name="name-pt-BR"
            maxLength={80}
            value={ptBR}
            onChange={(event) => {
              setPtBR(event.target.value);
            }}
          />
        </Field>
        <Button
          type="submit"
          variant="primary"
          disabled={create.isPending || selectedUniverse === ''}
        >
          {t('characters.add')}
        </Button>
      </form>
      <p className="mt-3 text-xs text-fg-muted">{t('characters.addHint')}</p>
      <div className="mt-2">
        <ErrorNotice error={create.error} />
      </div>
    </Card>
  );
}

export function CharactersPage() {
  const { t } = useTranslation('admin');
  const [search, setSearch] = useState('');
  const [universeId, setUniverseId] = useState('');
  const [status, setStatus] = useState<CharacterStatus | ''>('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<CharacterStatus>('RESTRICTED');
  const deferredSearch = useDeferredValue(search);

  const filters = { search: deferredSearch, universeId, status, page };
  const universes = useQuery({ queryKey: ['admin', 'universes'], queryFn: adminApi.universes });
  const characters = useQuery({
    queryKey: ['admin', 'characters', filters],
    queryFn: () => adminApi.characters(filters),
    placeholderData: keepPreviousData,
  });

  const setOne = useAdminMutation((input: { id: string; status: CharacterStatus }) =>
    adminApi.setStatus(input.id, input.status),
  );
  const bulk = useAdminMutation(adminApi.bulkStatus, () => {
    setSelected(new Set());
  });

  const items = characters.data?.items ?? [];
  const pageCount = Math.max(
    1,
    Math.ceil((characters.data?.total ?? 0) / (characters.data?.pageSize ?? 50)),
  );
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));

  const toggle = (id: string): void => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const resetPage = (): void => {
    setPage(1);
    setSelected(new Set());
  };

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">{t('characters.title')}</h1>
      <CreateCharacterForm />

      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('characters.search')}>
            <Input
              type="search"
              name="search"
              value={search}
              placeholder={t('characters.searchPlaceholder')}
              onChange={(event) => {
                setSearch(event.target.value);
                resetPage();
              }}
            />
          </Field>
          <Field label={t('fields.universe')}>
            <Select
              name="filter-universe"
              value={universeId}
              onChange={(event) => {
                setUniverseId(event.target.value);
                resetPage();
              }}
            >
              <option value="">{t('characters.allUniverses')}</option>
              {universes.data?.map((universe) => (
                <option key={universe.id} value={universe.id}>
                  {universe.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('fields.status')}>
            <Select
              name="filter-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as CharacterStatus | '');
                resetPage();
              }}
            >
              <option value="">{t('characters.allStatuses')}</option>
              {CHARACTER_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`status.${value}.label`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {selected.size > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-control bg-surface-sunken p-3 text-sm">
            <span>{t('characters.selected', { count: selected.size })}</span>
            <Select
              name="bulk-status"
              aria-label={t('characters.bulkLabel')}
              value={bulkStatus}
              onChange={(event) => {
                setBulkStatus(event.target.value as CharacterStatus);
              }}
            >
              {CHARACTER_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`status.${value}.label`)}
                </option>
              ))}
            </Select>
            <Button
              variant="primary"
              disabled={bulk.isPending}
              onClick={() => {
                bulk.mutate({ ids: [...selected], status: bulkStatus });
              }}
            >
              {t('characters.bulkApply')}
            </Button>
            <span className="text-xs text-fg-muted">{t('characters.bulkHint')}</span>
          </div>
        )}
        {bulk.data && (
          <div className="mt-3">
            <Notice tone="success">{t('characters.bulkDone', { count: bulk.data.changed })}</Notice>
          </div>
        )}
        <div className="mt-3 space-y-2">
          <ErrorNotice error={characters.error} />
          <ErrorNotice error={setOne.error} />
          <ErrorNotice error={bulk.error} />
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="p-2">
                  <Checkbox
                    label={<span className="sr-only">{t('characters.selectAll')}</span>}
                    checked={allSelected}
                    onChange={() => {
                      setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)));
                    }}
                  />
                </th>
                <th className="p-2">{t('fields.name')}</th>
                <th className="p-2">{t('fields.universe')}</th>
                <th className="p-2">{t('fields.status')}</th>
                <th className="p-2">{t('fields.classification')}</th>
                <th className="p-2">{t('fields.eligibility')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((character) => (
                <tr
                  key={character.id}
                  className="border-t border-line align-top"
                  data-slug={character.slug}
                >
                  <td className="p-2">
                    <Checkbox
                      label={<span className="sr-only">{localizedName(character.names)}</span>}
                      checked={selected.has(character.id)}
                      onChange={() => {
                        toggle(character.id);
                      }}
                    />
                  </td>
                  <td className="p-2">
                    <Link
                      to={`/admin/characters/${character.id}`}
                      className="font-medium text-accent-hover hover:underline"
                    >
                      {localizedName(character.names)}
                    </Link>
                    {character.coreExcluded && (
                      <div className="mt-1">
                        <Badge tone="danger">{t('characters.coreExcluded')}</Badge>
                      </div>
                    )}
                  </td>
                  <td className="p-2 text-fg-soft">{character.universe.name}</td>
                  <td className="p-2">
                    <Select
                      aria-label={t('characters.statusOf', {
                        name: localizedName(character.names),
                      })}
                      value={character.status}
                      disabled={setOne.isPending}
                      onChange={(event) => {
                        setOne.mutate({
                          id: character.id,
                          status: event.target.value as CharacterStatus,
                        });
                      }}
                    >
                      {CHARACTER_STATUSES.map((value) => (
                        <option key={value} value={value}>
                          {t(`status.${value}.label`)}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="p-2">
                    <Badge tone={character.ageClass === 'ADULT_VERIFIED' ? 'success' : 'neutral'}>
                      {t(`ageClass.${character.ageClass}`)}
                    </Badge>
                  </td>
                  <td className="p-2">
                    <EligibilitySummary character={character} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {characters.isSuccess && items.length === 0 && (
            <p className="p-4 text-sm text-fg-muted">{t('characters.empty')}</p>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between text-sm text-fg-muted">
          <span>{t('characters.total', { count: characters.data?.total ?? 0 })}</span>
          <div className="flex items-center gap-2">
            <Button
              disabled={page <= 1}
              onClick={() => {
                setPage(page - 1);
              }}
            >
              {t('pagination.previous')}
            </Button>
            <span>{t('pagination.page', { page, pageCount })}</span>
            <Button
              disabled={page >= pageCount}
              onClick={() => {
                setPage(page + 1);
              }}
            >
              {t('pagination.next')}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
