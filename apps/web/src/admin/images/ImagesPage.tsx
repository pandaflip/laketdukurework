import { ASSET_REVIEWS, type AssetReview } from '@app/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useEffect, useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { Badge, Button, Card, CardTitle, Field, Input, Notice, Select } from '../../design/ui';
import { currentLocale } from '../../i18n';
import { adminApi, errorCodeOf, imageUrl } from '../../lib/api';
import { ErrorNotice, localizedName } from '../shared';
import { ReviewBadge } from './ReviewPanel';

interface QueueItem {
  readonly key: number;
  readonly name: string;
  readonly status: 'waiting' | 'importing' | 'done' | 'failed';
  readonly imageId?: string;
  readonly code?: string;
}

/** Search a character by name, then pick it: the choice is kept in the address. */
function CharacterPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { t } = useTranslation('images');
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search);
  const results = useQuery({
    queryKey: ['admin', 'characters', { search: deferred, pageSize: 20 }],
    queryFn: () => adminApi.characters({ search: deferred }),
    placeholderData: keepPreviousData,
  });
  const selected = useQuery({
    queryKey: ['admin', 'character', value],
    queryFn: () => adminApi.character(value),
    enabled: value !== '',
  });
  const options = results.data?.items.slice(0, 20) ?? [];
  const known =
    selected.data && !options.some((item) => item.id === selected.data.id) ? [selected.data] : [];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t('import.search')} hint={t('import.searchHint')}>
        <Input
          type="search"
          name="character-search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      </Field>
      <Field label={t('import.character')}>
        <Select
          name="character"
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          <option value="">{t('import.noCharacter')}</option>
          {[...known, ...options].map((character) => (
            <option key={character.id} value={character.id}>
              {localizedName(character.names)} · {character.universe.name}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

/**
 * Import by file selection or drag and drop. Files are sent one after the
 * other, each to the chosen character; the server decides what is acceptable.
 */
function ImportZone({ characterId, autoOpen }: { characterId: string; autoOpen: boolean }) {
  const { t } = useTranslation(['images', 'errors']);
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<readonly QueueItem[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const counter = useRef(0);

  const patch = (key: number, change: Partial<QueueItem>): void => {
    setQueue((items) => items.map((item) => (item.key === key ? { ...item, ...change } : item)));
  };

  const run = async (files: File[]): Promise<void> => {
    if (characterId === '' || files.length === 0) return;
    const items = files.map((file): QueueItem => ({
      key: (counter.current += 1),
      name: file.name,
      status: 'waiting',
    }));
    setQueue((previous) => [...items, ...previous].slice(0, 30));
    setBusy(true);
    for (const [index, file] of files.entries()) {
      const item = items[index];
      if (!item) continue;
      patch(item.key, { status: 'importing' });
      try {
        const created = await adminApi.importImage(characterId, file);
        patch(item.key, { status: 'done', imageId: created.id });
        await client.invalidateQueries({ queryKey: ['admin'] });
      } catch (error) {
        patch(item.key, { status: 'failed', code: errorCodeOf(error) });
      }
    }
    setBusy(false);
  };

  useEffect(() => {
    // "Save and add another" lands here with the character already chosen.
    if (autoOpen) document.getElementById('import-drop')?.scrollIntoView({ block: 'center' });
  }, [autoOpen]);

  const onDrop = (event: DragEvent): void => {
    event.preventDefault();
    setOver(false);
    void run([...event.dataTransfer.files]);
  };

  return (
    <Card id="import">
      <CardTitle>{t('import.title')}</CardTitle>
      <div
        id="import-drop"
        data-testid="dropzone"
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => {
          setOver(false);
        }}
        onDrop={onDrop}
        className={`mt-4 flex flex-col items-center gap-3 rounded-card border-2 border-dashed p-8 text-center ${
          over ? 'border-accent-text bg-surface-sunken' : 'border-line-strong'
        }`}
      >
        <p className="text-fg-soft">{t('import.drop')}</p>
        <p className="text-xs text-fg-muted">{t('import.or')}</p>
        <Button
          variant="primary"
          disabled={characterId === '' || busy}
          onClick={() => {
            input.current?.click();
          }}
        >
          {t('import.choose')}
        </Button>
        <input
          ref={input}
          hidden
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          data-testid="file-input"
          onChange={(event) => {
            void run([...(event.target.files ?? [])]);
            event.target.value = ''; // the same file can be chosen again
          }}
        />
        <p className="text-xs text-fg-muted">{t('import.hint')}</p>
        {characterId === '' && <Notice tone="warning">{t('import.pick')}</Notice>}
      </div>

      {queue.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm" aria-live="polite" aria-label={t('import.queue')}>
          {queue.map((item) => (
            <li
              key={item.key}
              className="flex flex-wrap items-center gap-2"
              data-status={item.status}
            >
              <span className="font-medium">{item.name}</span>
              {item.status === 'failed' ? (
                <Badge tone="danger">
                  {t(`errors:${item.code ?? 'INTERNAL_ERROR'}` as 'errors:INTERNAL_ERROR')}
                </Badge>
              ) : (
                <Badge tone={item.status === 'done' ? 'success' : 'neutral'}>
                  {t(`import.${item.status}`)}
                </Badge>
              )}
              {item.imageId !== undefined && (
                <Link
                  to={`/admin/images/${item.imageId}`}
                  className="text-accent-text hover:underline"
                >
                  {t('import.open')}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function ImagesPage() {
  const { t } = useTranslation('images');
  const [params, setParams] = useSearchParams();
  const characterId = params.get('characterId') ?? '';
  const review = (params.get('review') ?? '') as AssetReview | '';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);

  const set = (change: Record<string, string>): void => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(change)) {
      if (value === '') next.delete(key);
      else next.set(key, value);
    }
    if (!('page' in change)) next.delete('page');
    next.delete('add');
    setParams(next, { replace: true });
  };

  const filters = { characterId, review, page };
  const images = useQuery({
    queryKey: ['admin', 'images', filters],
    queryFn: () => adminApi.images(filters),
    placeholderData: keepPreviousData,
  });
  const items = images.data?.items ?? [];
  const pageCount = Math.max(
    1,
    Math.ceil((images.data?.total ?? 0) / (images.data?.pageSize ?? 24)),
  );
  const formatDate = new Intl.DateTimeFormat(currentLocale(), {
    dateStyle: 'short',
    timeStyle: 'short',
  });

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">{t('list.title')}</h1>
      <p className="text-sm text-fg-muted">{t('list.intro')}</p>

      <Card>
        <CharacterPicker
          value={characterId}
          onChange={(id) => {
            set({ characterId: id });
          }}
        />
      </Card>

      <ImportZone characterId={characterId} autoOpen={params.get('add') === '1'} />

      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Field label={t('list.review')}>
            <Select
              name="filter-review"
              value={review}
              onChange={(event) => {
                set({ review: event.target.value });
              }}
            >
              <option value="">{t('list.allReviews')}</option>
              {ASSET_REVIEWS.map((value) => (
                <option key={value} value={value}>
                  {t(`review.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <ErrorNotice error={images.error} />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t('list.title')}</caption>
            <thead className="text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th scope="col" className="p-2">
                  {t('list.columns.image')}
                </th>
                <th scope="col" className="p-2">
                  {t('list.columns.character')}
                </th>
                <th scope="col" className="p-2">
                  {t('list.columns.status')}
                </th>
                <th scope="col" className="p-2">
                  {t('list.columns.sequence')}
                </th>
                <th scope="col" className="p-2">
                  {t('list.columns.updated')}
                </th>
                <th scope="col" className="p-2">
                  <span className="sr-only">{t('list.edit')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((image) => (
                <tr
                  key={image.id}
                  className="border-t border-line align-middle"
                  data-image-id={image.id}
                >
                  <td className="p-2">
                    <img
                      src={imageUrl(image.id, 'thumb')}
                      alt={image.label}
                      loading="lazy"
                      width={96}
                      className="h-auto w-24 rounded-control border border-line bg-surface-sunken"
                    />
                  </td>
                  <td className="p-2">
                    <div className="font-medium">{localizedName(image.characterNames)}</div>
                    <div className="text-xs text-fg-muted">
                      {image.label} · {t('list.size', { width: image.width, height: image.height })}
                    </div>
                  </td>
                  <td className="p-2">
                    <ReviewBadge review={image.review} />
                  </td>
                  <td className="p-2">
                    <Badge outline tone={image.hasSequence ? 'success' : 'neutral'}>
                      {image.hasSequence
                        ? t('list.sequenceSteps', { count: image.stepCount })
                        : t('list.sequenceNone')}
                    </Badge>
                  </td>
                  <td className="p-2 text-fg-muted">
                    {formatDate.format(new Date(image.updatedAt))}
                  </td>
                  <td className="p-2">
                    <Link
                      to={`/admin/images/${image.id}`}
                      className="text-accent-text hover:underline"
                    >
                      {t('list.edit')}
                      <span className="sr-only"> {image.label}</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {images.isSuccess && items.length === 0 && (
            <p className="p-4 text-sm text-fg-muted">{t('list.empty')}</p>
          )}
        </div>
        <div className="mt-4 flex items-center justify-between text-sm text-fg-muted">
          <span>{t('list.total', { count: images.data?.total ?? 0 })}</span>
          <div className="flex items-center gap-2">
            <Button
              disabled={page <= 1}
              onClick={() => {
                set({ page: String(page - 1) });
              }}
            >
              {t('list.previous')}
            </Button>
            <span>{t('list.page', { page, pageCount })}</span>
            <Button
              disabled={page >= pageCount}
              onClick={() => {
                set({ page: String(page + 1) });
              }}
            >
              {t('list.next')}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
