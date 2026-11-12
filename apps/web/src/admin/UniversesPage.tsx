import {
  MODE_IDS,
  MODES,
  sensitiveModesAvailable,
  STRICT_NOTE_MIN_LENGTH,
  UNIVERSE_AUDIENCES,
  type ModeId,
  type UniverseAudience,
  type UniverseDto,
} from '@app/shared';
import { useQuery } from '@tanstack/react-query';
import { useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
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
import { adminApi } from '../lib/api';
import { ErrorNotice, useAdminMutation } from './shared';

const NEUTRAL_MODES = MODE_IDS.filter((id) => MODES[id].sensitivity === 'neutral');

function ModeChecklist({
  value,
  onChange,
  sensitiveLocked,
}: {
  value: readonly ModeId[];
  onChange: (next: ModeId[]) => void;
  sensitiveLocked: boolean;
}) {
  const { t } = useTranslation(['admin', 'modes']);
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {MODE_IDS.map((modeId) => {
        const sensitive = MODES[modeId].sensitivity !== 'neutral';
        return (
          <Checkbox
            key={modeId}
            name={`mode-${modeId}`}
            checked={value.includes(modeId)}
            disabled={sensitive && sensitiveLocked}
            onChange={(event) => {
              onChange(
                MODE_IDS.filter((id) =>
                  id === modeId ? event.target.checked : value.includes(id),
                ),
              );
            }}
            label={
              <span className="flex flex-wrap items-center gap-2">
                {t(`${modeId}.name`, { ns: 'modes' })}
                {sensitive && <Badge tone="warning">{t('universes.sensitive')}</Badge>}
              </span>
            }
          />
        );
      })}
    </div>
  );
}

const AUDIENCE_TONE = { GENERAL: 'success', YOUTH: 'warning', UNREVIEWED: 'danger' } as const;

/**
 * Audience review. Stricter classifications apply at once and switch the
 * sensitive modes off; `General audience` is the permissive direction and
 * needs a confirmation and a written justification. Universes the code fixes
 * as young-audience cannot be relaxed.
 */
function AudiencePanel({ universe }: { universe: UniverseDto }) {
  const { t } = useTranslation('admin');
  const [value, setValue] = useState<UniverseAudience>(universe.audienceSetting);
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const save = useAdminMutation(() =>
    adminApi.setAudience(universe.id, {
      audience: value,
      note,
      ...(confirm ? { confirm } : {}),
    }),
  );
  const toGeneral = value === 'GENERAL';

  return (
    <form
      className="space-y-3 border-t border-line pt-4"
      onSubmit={(event: SyntheticEvent) => {
        event.preventDefault();
        save.mutate(undefined);
      }}
    >
      {universe.audience === 'UNREVIEWED' && (
        <Notice tone="danger">{t('universes.unreviewedNotice')}</Notice>
      )}
      <Field label={t('universes.audienceTitle')} hint={t(`universes.audienceHint.${value}`)}>
        <Select
          name="audience"
          value={value}
          onChange={(event) => {
            setValue(event.target.value as UniverseAudience);
            setConfirm(false);
          }}
        >
          {UNIVERSE_AUDIENCES.map((audience) => (
            <option
              key={audience}
              value={audience}
              disabled={audience === 'GENERAL' && universe.audienceLockedByPolicy}
            >
              {t(`universes.audience.${audience}`)}
            </option>
          ))}
        </Select>
      </Field>
      {universe.audienceLockedByPolicy && (
        <p className="text-xs text-fg-muted">{t('universes.audienceFixed')}</p>
      )}
      {toGeneral && (
        <>
          <Field
            label={t('universes.audienceNote')}
            hint={t('universes.audienceNoteHint', { count: STRICT_NOTE_MIN_LENGTH })}
          >
            <Textarea
              name="audience-note"
              required
              minLength={STRICT_NOTE_MIN_LENGTH}
              maxLength={1000}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          </Field>
          <Checkbox
            name="audience-confirm"
            required
            checked={confirm}
            onChange={(event) => {
              setConfirm(event.target.checked);
            }}
            label={t('universes.audienceConfirm')}
          />
        </>
      )}
      {!toGeneral && value !== universe.audienceSetting && (
        <p className="text-xs text-fg-muted">{t('universes.audienceStricter')}</p>
      )}
      {universe.audienceNote !== null && universe.audienceSetting === 'GENERAL' && (
        <p className="text-xs text-fg-muted">{universe.audienceNote}</p>
      )}
      <ErrorNotice error={save.error} />
      <Button type="submit" disabled={save.isPending || value === universe.audienceSetting}>
        {t('universes.audienceSave')}
      </Button>
    </form>
  );
}

/**
 * Universes associated with a young audience keep sensitive modes locked. The
 * unlock is a deliberate, justified and logged exception; locking again is
 * immediate. Neither changes any character or image check.
 */
function SensitiveLockPanel({ universe }: { universe: UniverseDto }) {
  const { t } = useTranslation('admin');
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const unlock = useAdminMutation(() =>
    adminApi.unlockSensitive(universe.id, { note, ...(confirm ? { confirm } : {}) }),
  );
  const lock = useAdminMutation(() => adminApi.lockSensitive(universe.id));

  if (universe.audience !== 'YOUTH') return null;

  return (
    <div className="space-y-3 border-t border-line pt-4" data-testid="sensitive-lock">
      <Notice tone="warning">{t('universes.youthNotice')}</Notice>
      {universe.sensitiveUnlocked ? (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm">
            <Badge tone="warning">{t('universes.unlocked')}</Badge>
            <span className="text-fg-muted">{universe.sensitiveUnlockNote}</span>
          </p>
          <p className="text-xs text-fg-muted">{t('universes.lockHint')}</p>
          <Button
            variant="danger"
            disabled={lock.isPending}
            onClick={() => {
              lock.mutate(undefined);
            }}
          >
            {t('universes.lockAction')}
          </Button>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event: SyntheticEvent) => {
            event.preventDefault();
            unlock.mutate(undefined);
          }}
        >
          <p className="flex items-center gap-2 text-sm">
            <Badge>{t('universes.locked')}</Badge>
          </p>
          <p className="text-sm text-fg-muted">{t('universes.unlockIntro')}</p>
          <Field
            label={t('universes.unlockNote')}
            hint={t('universes.unlockNoteHint', { count: STRICT_NOTE_MIN_LENGTH })}
          >
            <Textarea
              name="unlock-note"
              required
              minLength={STRICT_NOTE_MIN_LENGTH}
              maxLength={1000}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          </Field>
          <Checkbox
            name="unlock-confirm"
            required
            checked={confirm}
            onChange={(event) => {
              setConfirm(event.target.checked);
            }}
            label={t('universes.unlockConfirm')}
          />
          <Button type="submit" disabled={unlock.isPending}>
            {t('universes.unlockAction')}
          </Button>
        </form>
      )}
      <ErrorNotice error={unlock.error} />
      <ErrorNotice error={lock.error} />
    </div>
  );
}

function UniverseForm({ universe }: { universe: UniverseDto }) {
  const { t } = useTranslation('admin');
  const [name, setName] = useState(universe.name);
  const [modes, setModes] = useState<ModeId[]>([...universe.enabledModes]);
  const update = useAdminMutation((input: { name: string; enabledModes: ModeId[] }) =>
    adminApi.updateUniverse(universe.id, input),
  );

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    update.mutate({ name, enabledModes: modes });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label={t('fields.name')} hint={universe.slug}>
          <Input
            required
            maxLength={80}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={AUDIENCE_TONE[universe.audience]}>
            {t(`universes.audience.${universe.audience}`)}
          </Badge>
          <Badge>{t('universes.characterCount', { count: universe.characterCount })}</Badge>
        </div>
      </div>
      <ModeChecklist
        value={modes}
        onChange={setModes}
        sensitiveLocked={
          !sensitiveModesAvailable({
            slug: universe.slug,
            name: universe.name,
            audience: universe.audience,
            sensitiveUnlocked: universe.sensitiveUnlocked,
          })
        }
      />
      <ErrorNotice error={update.error} />
      <Button type="submit" variant="primary" disabled={update.isPending}>
        {t('actions.save')}
      </Button>
    </form>
  );
}

/**
 * Each panel is remounted only when ITS OWN stored values change, so saving one
 * never discards what is being typed in another (a justification, for instance).
 */
function UniverseCard({ universe }: { universe: UniverseDto }) {
  return (
    <Card data-universe={universe.slug}>
      <UniverseForm
        key={`${universe.name}:${universe.enabledModes.join(',')}:${universe.audience}:${universe.sensitiveUnlocked}`}
        universe={universe}
      />
      <div className="mt-4 space-y-4">
        <AudiencePanel
          key={`${universe.audienceSetting}:${universe.audienceNote ?? ''}`}
          universe={universe}
        />
        <SensitiveLockPanel key={String(universe.sensitiveUnlocked)} universe={universe} />
      </div>
    </Card>
  );
}

function CreateUniverseForm() {
  const { t } = useTranslation('admin');
  const [name, setName] = useState('');
  const create = useAdminMutation(adminApi.createUniverse, () => {
    setName('');
  });

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    // Sensitive modes are never enabled at creation: it is a separate, explicit step.
    create.mutate({ name, enabledModes: NEUTRAL_MODES });
  };

  return (
    <Card>
      <CardTitle>{t('universes.addTitle')}</CardTitle>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <Field label={t('fields.name')}>
          <Input
            name="universe-name"
            required
            maxLength={80}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </Field>
        <Button type="submit" variant="primary" disabled={create.isPending}>
          {t('universes.add')}
        </Button>
      </form>
      <p className="mt-3 text-xs text-fg-muted">{t('universes.addHint')}</p>
      <div className="mt-2">
        <ErrorNotice error={create.error} />
      </div>
    </Card>
  );
}

export function UniversesPage() {
  const { t } = useTranslation('admin');
  const universes = useQuery({ queryKey: ['admin', 'universes'], queryFn: adminApi.universes });

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">{t('universes.title')}</h1>
      <CreateUniverseForm />
      <ErrorNotice error={universes.error} />
      <div className="grid gap-4 lg:grid-cols-2">
        {universes.data?.map((universe) => (
          <UniverseCard key={universe.id} universe={universe} />
        ))}
      </div>
    </div>
  );
}
