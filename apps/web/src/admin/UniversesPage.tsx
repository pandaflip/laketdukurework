import { MODE_IDS, MODES, type ModeId, type UniverseDto } from '@app/shared';
import { useQuery } from '@tanstack/react-query';
import { useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, CardTitle, Checkbox, Field, Input, Notice } from '../design/ui';
import { adminApi } from '../lib/api';
import { ErrorNotice, useAdminMutation } from './shared';

const NEUTRAL_MODES = MODE_IDS.filter((id) => MODES[id].sensitivity === 'neutral');

function ModeChecklist({
  value,
  onChange,
  neverSensitive,
}: {
  value: readonly ModeId[];
  onChange: (next: ModeId[]) => void;
  neverSensitive: boolean;
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
            disabled={sensitive && neverSensitive}
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

function UniverseCard({ universe }: { universe: UniverseDto }) {
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
    <Card data-universe={universe.slug}>
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
          <Badge>{t('universes.characterCount', { count: universe.characterCount })}</Badge>
        </div>
        <ModeChecklist value={modes} onChange={setModes} neverSensitive={universe.neverSensitive} />
        {universe.neverSensitive && <Notice tone="warning">{t('universes.neverSensitive')}</Notice>}
        <ErrorNotice error={update.error} />
        <Button type="submit" variant="primary" disabled={update.isPending}>
          {t('actions.save')}
        </Button>
      </form>
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
          // Remount when the server data changes so the form shows the saved values.
          <UniverseCard
            key={`${universe.id}:${universe.name}:${universe.enabledModes.join(',')}`}
            universe={universe}
          />
        ))}
      </div>
    </div>
  );
}
