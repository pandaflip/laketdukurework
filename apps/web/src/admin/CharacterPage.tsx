import {
  AGE_CLASSES,
  CHARACTER_STATUSES,
  isCompositeMode,
  MODE_IDS,
  SUPPORTED_LOCALES,
  type AgeClass,
  type CharacterDto,
  type CharacterStatus,
  type Locale,
  type LocalizedNames,
  type ModeId,
  type VariantDto,
} from '@app/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useParams } from 'react-router';
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
  Textarea,
} from '../design/ui';
import { LOCALE_NAMES } from '../i18n/resources';
import { adminApi } from '../lib/api';
import { AuditList } from './AuditList';
import { ErrorNotice, localizedName, ReasonList, splitAliases, useAdminMutation } from './shared';

type PerLocale = Record<Locale, string>;

function toNames(values: PerLocale): LocalizedNames {
  const fr = values.fr.trim();
  const ptBR = values['pt-BR'].trim();
  return {
    en: values.en,
    ...(fr === '' ? {} : { fr }),
    ...(ptBR === '' ? {} : { 'pt-BR': ptBR }),
  };
}

function LocaleInputs({
  idPrefix,
  values,
  onChange,
  requiredLocale,
}: {
  idPrefix: string;
  values: PerLocale;
  onChange: (next: PerLocale) => void;
  requiredLocale?: Locale;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {SUPPORTED_LOCALES.map((locale) => (
        <Field key={locale} label={LOCALE_NAMES[locale]}>
          <Input
            name={`${idPrefix}-${locale}`}
            lang={locale}
            required={locale === requiredLocale}
            value={values[locale]}
            onChange={(event) => {
              onChange({ ...values, [locale]: event.target.value });
            }}
          />
        </Field>
      ))}
    </div>
  );
}

function LabelsCard({ character }: { character: CharacterDto }) {
  const { t } = useTranslation('admin');
  const [names, setNames] = useState<PerLocale>({
    en: character.names.en,
    fr: character.names.fr ?? '',
    'pt-BR': character.names['pt-BR'] ?? '',
  });
  const [aliases, setAliases] = useState<PerLocale>({
    en: character.aliases.en.join(', '),
    fr: character.aliases.fr.join(', '),
    'pt-BR': character.aliases['pt-BR'].join(', '),
  });
  const save = useAdminMutation(() =>
    adminApi.updateLabels(character.id, {
      names: toNames(names),
      aliases: {
        en: splitAliases(aliases.en),
        fr: splitAliases(aliases.fr),
        'pt-BR': splitAliases(aliases['pt-BR']),
      },
    }),
  );

  return (
    <Card>
      <CardTitle>{t('character.namesTitle')}</CardTitle>
      <form
        className="space-y-4"
        onSubmit={(event: SyntheticEvent) => {
          event.preventDefault();
          save.mutate(undefined);
        }}
      >
        <LocaleInputs idPrefix="name" values={names} onChange={setNames} requiredLocale="en" />
        <div>
          <p className="mb-2 text-sm font-medium text-fg-soft">{t('character.aliasesTitle')}</p>
          <LocaleInputs idPrefix="aliases" values={aliases} onChange={setAliases} />
          <p className="mt-2 text-xs text-fg-muted">{t('character.aliasesHint')}</p>
        </div>
        <ErrorNotice error={save.error} />
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {t('actions.save')}
        </Button>
      </form>
    </Card>
  );
}

function StatusCard({ character }: { character: CharacterDto }) {
  const { t } = useTranslation('admin');
  const save = useAdminMutation((status: CharacterStatus) =>
    adminApi.setStatus(character.id, status),
  );

  return (
    <Card>
      <CardTitle>{t('fields.status')}</CardTitle>
      <div className="space-y-3">
        <Select
          name="status"
          aria-label={t('fields.status')}
          value={character.status}
          disabled={save.isPending}
          onChange={(event) => {
            save.mutate(event.target.value as CharacterStatus);
          }}
        >
          {CHARACTER_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`status.${value}.label`)}
            </option>
          ))}
        </Select>
        <p className="text-sm text-fg-muted">{t(`status.${character.status}.hint`)}</p>
        <p className="text-xs text-fg-muted">{t('character.statusNote')}</p>
        <ErrorNotice error={save.error} />
      </div>
    </Card>
  );
}

function ClassificationCard({ character }: { character: CharacterDto }) {
  const { t } = useTranslation('admin');
  const [ageClass, setAgeClass] = useState<AgeClass>(character.ageClass);
  const [note, setNote] = useState(character.ageClassNote ?? '');
  const [confirm, setConfirm] = useState(false);
  const save = useAdminMutation(() =>
    adminApi.setClassification(character.id, { ageClass, note, ...(confirm ? { confirm } : {}) }),
  );
  const adult = ageClass === 'ADULT_VERIFIED';

  return (
    <Card>
      <CardTitle>{t('fields.classification')}</CardTitle>
      <form
        className="space-y-4"
        onSubmit={(event: SyntheticEvent) => {
          event.preventDefault();
          save.mutate(undefined);
        }}
      >
        <p className="text-sm text-fg-muted">{t('character.classificationIntro')}</p>
        {character.coreExcluded && <Notice tone="danger">{t('character.coreExcluded')}</Notice>}
        <Select
          name="ageClass"
          aria-label={t('fields.classification')}
          value={ageClass}
          onChange={(event) => {
            setAgeClass(event.target.value as AgeClass);
            setConfirm(false);
          }}
        >
          {AGE_CLASSES.map((value) => (
            <option
              key={value}
              value={value}
              disabled={value === 'ADULT_VERIFIED' && character.coreExcluded}
            >
              {t(`ageClass.${value}`)}
            </option>
          ))}
        </Select>
        <Field
          label={t('character.note')}
          hint={
            adult
              ? t('character.noteHintAdult', { count: character.adultNoteMinLength })
              : t('character.noteHint')
          }
        >
          <Textarea
            name="note"
            maxLength={1000}
            required={adult}
            minLength={adult ? character.adultNoteMinLength : undefined}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </Field>
        {adult && (
          <Notice tone="warning">
            <Checkbox
              name="confirm"
              required
              checked={confirm}
              onChange={(event) => {
                setConfirm(event.target.checked);
              }}
              label={t('character.confirmAdult')}
            />
          </Notice>
        )}
        <ErrorNotice error={save.error} />
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {t('character.saveClassification')}
        </Button>
      </form>
    </Card>
  );
}

function BlockedModesCard({ character }: { character: CharacterDto }) {
  const { t } = useTranslation(['admin', 'modes']);
  const [blocked, setBlocked] = useState<ModeId[]>([...character.blockedModes]);
  const save = useAdminMutation(() => adminApi.setBlockedModes(character.id, blocked));

  return (
    <Card>
      <CardTitle>{t('character.blockedTitle')}</CardTitle>
      <form
        className="space-y-4"
        onSubmit={(event: SyntheticEvent) => {
          event.preventDefault();
          save.mutate(undefined);
        }}
      >
        <p className="text-sm text-fg-muted">{t('character.blockedIntro')}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {MODE_IDS.map((modeId) => (
            <Checkbox
              key={modeId}
              name={`blocked-${modeId}`}
              checked={blocked.includes(modeId)}
              onChange={(event) => {
                setBlocked(
                  MODE_IDS.filter((id) =>
                    id === modeId ? event.target.checked : blocked.includes(id),
                  ),
                );
              }}
              label={t(`${modeId}.name`, { ns: 'modes' })}
            />
          ))}
        </div>
        <ErrorNotice error={save.error} />
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {t('actions.save')}
        </Button>
      </form>
    </Card>
  );
}

/**
 * Detailed eligibility, mode by mode, with the reasons. The character's
 * eligibility and the approval of its images are two separate columns of
 * information: a playable challenge needs both.
 */
function EligibilityCard({ character }: { character: CharacterDto }) {
  const { t } = useTranslation(['admin', 'modes']);
  return (
    <Card id="eligibility" className="scroll-mt-4">
      <CardTitle>{t('fields.eligibility')}</CardTitle>
      <p className="mb-3 text-sm text-fg-muted">{t('character.eligibilityIntro')}</p>
      <ul className="divide-y divide-line">
        {MODE_IDS.map((modeId) => {
          const outcome = character.eligibility[modeId];
          const composite = isCompositeMode(modeId);
          return (
            <li key={modeId} className="py-2" data-mode-id={modeId}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{t(`${modeId}.name`, { ns: 'modes' })}</span>
                <span className="flex flex-wrap items-center gap-1">
                  {composite ? (
                    <Badge>{t('eligibility.perRound')}</Badge>
                  ) : (
                    <>
                      <Badge tone={outcome.eligible ? 'success' : 'neutral'}>
                        {t(outcome.eligible ? 'eligibility.eligible' : 'eligibility.notEligible')}
                      </Badge>
                      <Badge
                        outline
                        tone={character.usableImages[modeId] > 0 ? 'success' : 'neutral'}
                      >
                        {t('images.usable', { count: character.usableImages[modeId] })}
                      </Badge>
                    </>
                  )}
                </span>
              </div>
              {composite ? (
                <p className="mt-1 text-xs text-fg-muted">{t('eligibility.compositeNote')}</p>
              ) : (
                !outcome.eligible && <ReasonList reasons={outcome.reasons} />
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ImagesCard({ images }: { images: CharacterDto['images'] }) {
  const { t } = useTranslation('admin');
  const rows = [
    ['approvedNeutral', images.approvedNeutral],
    ['approvedSensitive', images.approvedSensitive],
    ['unverified', images.unverified],
    ['rejected', images.rejected],
  ] as const;
  return (
    <Card>
      <CardTitle>{t('images.title')}</CardTitle>
      <p className="mb-3 text-sm text-fg-muted">{t('images.intro')}</p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        {rows.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-fg-soft">{t(`images.${key}`)}</dt>
            <dd className="text-right font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-fg-muted">{t('images.importLater')}</p>
    </Card>
  );
}

function VariantForm({
  initial,
  submitLabel,
  onSubmit,
  pending,
}: {
  initial?: VariantDto;
  submitLabel: string;
  onSubmit: (names: LocalizedNames, reset: () => void) => void;
  pending: boolean;
}) {
  const empty: PerLocale = { en: '', fr: '', 'pt-BR': '' };
  const [names, setNames] = useState<PerLocale>(
    initial
      ? { en: initial.names.en, fr: initial.names.fr ?? '', 'pt-BR': initial.names['pt-BR'] ?? '' }
      : empty,
  );
  return (
    <form
      className="space-y-3"
      onSubmit={(event: SyntheticEvent) => {
        event.preventDefault();
        onSubmit(toNames(names), () => {
          setNames(empty);
        });
      }}
    >
      <LocaleInputs
        idPrefix={`variant-${initial?.id ?? 'new'}`}
        values={names}
        onChange={setNames}
        requiredLocale="en"
      />
      <Button type="submit" disabled={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}

function VariantsCard({ character }: { character: CharacterDto }) {
  const { t } = useTranslation('admin');
  const [editing, setEditing] = useState<string | null>(null);
  const create = useAdminMutation((names: LocalizedNames) =>
    adminApi.createVariant(character.id, { names }),
  );
  const update = useAdminMutation(
    (input: { id: string; names: LocalizedNames }) =>
      adminApi.updateVariant(input.id, { names: input.names }),
    () => {
      setEditing(null);
    },
  );
  const remove = useAdminMutation(adminApi.deleteVariant);

  return (
    <Card>
      <CardTitle>{t('character.variantsTitle')}</CardTitle>
      <p className="mb-3 text-sm text-fg-muted">{t('character.variantsIntro')}</p>
      <ul className="mb-4 divide-y divide-line">
        {character.variants.map((variant) => (
          <li key={variant.id} className="space-y-2 py-2 text-sm" data-variant={variant.slug}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-medium">{localizedName(variant.names)}</span>{' '}
                <span className="text-fg-muted">{Object.values(variant.names).join(' / ')}</span>
              </span>
              <span className="flex gap-2">
                <Button
                  onClick={() => {
                    setEditing(editing === variant.id ? null : variant.id);
                  }}
                >
                  {t('actions.edit')}
                </Button>
                <Button
                  variant="danger"
                  disabled={remove.isPending}
                  onClick={() => {
                    remove.mutate(variant.id);
                  }}
                >
                  {t('actions.delete')}
                </Button>
              </span>
            </div>
            {editing === variant.id && (
              <VariantForm
                initial={variant}
                submitLabel={t('actions.save')}
                pending={update.isPending}
                onSubmit={(names) => {
                  update.mutate({ id: variant.id, names });
                }}
              />
            )}
          </li>
        ))}
        {character.variants.length === 0 && (
          <li className="py-2 text-sm text-fg-muted">{t('character.noVariants')}</li>
        )}
      </ul>
      <VariantForm
        submitLabel={t('character.addVariant')}
        pending={create.isPending}
        onSubmit={(names, reset) => {
          create.mutate(names, { onSuccess: reset });
        }}
      />
      <div className="mt-3 space-y-2">
        <ErrorNotice error={create.error} />
        <ErrorNotice error={update.error} />
        <ErrorNotice error={remove.error} />
      </div>
    </Card>
  );
}

export function CharacterPage() {
  const { t } = useTranslation('admin');
  const { id = '' } = useParams();
  const { hash } = useLocation();
  const character = useQuery({
    queryKey: ['admin', 'character', id],
    queryFn: () => adminApi.character(id),
  });

  // The "Why?" link of the table lands on the eligibility details.
  useEffect(() => {
    if (hash === '#eligibility' && character.isSuccess) {
      document.getElementById('eligibility')?.scrollIntoView({ block: 'start' });
    }
  }, [hash, character.isSuccess]);

  if (character.isPending) return <Notice>{t('loading')}</Notice>;
  if (character.isError) return <ErrorNotice error={character.error} />;
  const data = character.data;
  // Each form is remounted only when ITS OWN stored values change, so saving
  // one card never discards what is being typed in another.
  const labelsKey = JSON.stringify([data.names, data.aliases]);
  const classificationKey = `${data.ageClass}:${data.ageClassNote ?? ''}`;
  const blockedKey = data.blockedModes.join(',');

  return (
    <div className="space-y-6">
      <div>
        <Link to="/admin" className="text-sm text-accent-text hover:underline">
          ← {t('nav.characters')}
        </Link>
        <h1 className="mt-2 font-display text-2xl font-bold">{localizedName(data.names)}</h1>
        <p className="text-sm text-fg-muted">
          {data.universe.name} · {data.slug}
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <LabelsCard key={labelsKey} character={data} />
        <EligibilityCard character={data} />
        <ImagesCard images={data.images} />
        <StatusCard character={data} />
        <ClassificationCard key={classificationKey} character={data} />
        <BlockedModesCard key={blockedKey} character={data} />
        <VariantsCard character={data} />
      </div>
      <Card>
        <CardTitle>{t('history.title')}</CardTitle>
        <AuditList entityId={data.id} />
      </Card>
    </div>
  );
}
