import {
  buildSteps,
  centerRect,
  checkGenerateInput,
  DEFAULT_ASPECT,
  DEFAULT_RANDOM_ZONE,
  DEFAULT_RANDOM_ZOOM_END,
  DEFAULT_RANDOM_ZOOM_START,
  DEFAULT_STEPS,
  generateRandomSequence,
  MAX_RANDOM_ZONE,
  MIN_RANDOM_ZONE,
  ASPECT_PRESETS,
  aspectRatio,
  fitFrame,
  maxZoomFor,
  MAX_STEPS,
  MIN_ZOOM,
  rectCenter,
  zoomOfRect,
  zoomRect,
  type Aspect,
  type GenerateInput,
  type GenerationWarning,
  type ImageDetailDto,
  type Point,
  type Rect,
  type StepDraft,
} from '@app/shared';
import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
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
} from '../../design/ui';
import { adminApi, imageUrl } from '../../lib/api';
import { ErrorNotice, useAdminMutation } from '../shared';
import { FrameView } from './FrameView';
import { DEFAULT_SETTINGS, readLastSettings, rememberSettings } from './lastSettings';
import { ReviewPanel } from './ReviewPanel';
import { SourceCanvas } from './SourceCanvas';

const aspectKey = (aspect: Aspect): string => `${aspect.w}:${aspect.h}`;
const sameAspect = (a: Aspect | null, b: Aspect): boolean =>
  a !== null && a.w === b.w && a.h === b.h;
const percent = (value: number): number => Math.round(value * 1000) / 10;
const toNumber = (value: string, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

type Mode = 'simple' | 'random' | 'advanced';
const MODES: readonly Mode[] = ['simple', 'random', 'advanced'];

/**
 * The editor of the Zoom Out sequence of one image.
 *
 * Random mode: the focus point is drawn automatically (in a central zone) and the
 * sequence generated for it, with the same generator; Relaunch draws again.
 * Nothing is drawn after saving: the saved sequence is fixed.
 *
 * Simple mode: click the focus point, choose the number of steps and the first
 * and last zoom, generate. Advanced mode: select a step, move or resize its
 * frame, rename, add, duplicate, delete or reorder steps, and regenerate from
 * the simple settings while keeping the hand-adjusted steps if asked to.
 * Frames are normalized to the source picture; the server checks them again.
 */
export function SequenceEditor({ image }: { image: ImageDetailDto }) {
  const { t } = useTranslation('images');
  const navigate = useNavigate();
  const saved = image.sequence;
  const last = readLastSettings();
  const size = { width: image.width, height: image.height };

  const [aspect, setAspect] = useState<Aspect>(saved?.aspect ?? last?.aspect ?? DEFAULT_ASPECT);
  // The ratio the current frames were made for: changing the ratio asks to generate again.
  const [framesAspect, setFramesAspect] = useState<Aspect | null>(saved?.aspect ?? null);
  const [focus, setFocus] = useState<Point>(saved?.params.focus ?? { x: 0.5, y: 0.5 });
  const [stepCount, setStepCount] = useState(saved?.params.steps ?? last?.steps ?? DEFAULT_STEPS);
  const [zoomStart, setZoomStart] = useState(
    saved?.params.zoomStart ?? last?.zoomStart ?? DEFAULT_SETTINGS.zoomStart,
  );
  const [zoomEnd, setZoomEnd] = useState(
    saved?.params.zoomEnd ?? last?.zoomEnd ?? DEFAULT_SETTINGS.zoomEnd,
  );
  const [steps, setSteps] = useState<readonly StepDraft[]>(saved?.steps ?? []);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<Mode>('simple');
  // Random mode has its own zooms (×12 to ×1 by default) and the zone the focus is drawn in.
  const [randomStart, setRandomStart] = useState(DEFAULT_RANDOM_ZOOM_START);
  const [randomEnd, setRandomEnd] = useState(DEFAULT_RANDOM_ZOOM_END);
  const [zonePercent, setZonePercent] = useState(Math.round(DEFAULT_RANDOM_ZONE * 100));
  // The settings the current frames were generated from: what is saved with the sequence.
  const [generated, setGenerated] = useState({
    steps: saved?.params.steps ?? last?.steps ?? DEFAULT_STEPS,
    zoomStart: saved?.params.zoomStart ?? last?.zoomStart ?? DEFAULT_SETTINGS.zoomStart,
    zoomEnd: saved?.params.zoomEnd ?? last?.zoomEnd ?? DEFAULT_SETTINGS.zoomEnd,
  });
  const [preserve, setPreserve] = useState(false);
  const [warnings, setWarnings] = useState<readonly GenerationWarning[]>([]);
  const [dropped, setDropped] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const ratio = aspectRatio(aspect);
  const zoomLimit = Math.floor(maxZoomFor(size, ratio) * 10) / 10;
  const input: GenerateInput = {
    image: size,
    ratio,
    focus,
    start: { kind: 'zoom', zoom: zoomStart },
    end: { kind: 'zoom', zoom: zoomEnd },
    steps: stepCount,
  };
  const problem = checkGenerateInput(input);
  const framesStale = steps.length > 0 && !sameAspect(framesAspect, aspect);
  const hasManual = steps.some((step) => step.manual);
  const current = steps[selected] ?? steps[0];
  const frameAspect = framesAspect ?? aspect;

  const touch = (): void => {
    setDirty(true);
    setJustSaved(false);
  };

  const generate = (): void => {
    if (problem) return;
    const result = buildSteps(
      input,
      framesStale ? [] : steps,
      preserve && hasManual && !framesStale,
    );
    setSteps(result.steps);
    setFramesAspect(aspect);
    setWarnings(result.warnings);
    setDropped(result.droppedManual);
    setGenerated({ steps: stepCount, zoomStart, zoomEnd });
    setSelected(0);
    touch();
  };

  // Random mode: new focus, new sequence, from the same generator. Always replaces every step.
  const randomRequest = {
    image: size,
    ratio,
    start: { kind: 'zoom', zoom: randomStart },
    end: { kind: 'zoom', zoom: randomEnd },
    steps: stepCount,
  } as const;
  const randomProblem = checkGenerateInput({ ...randomRequest, focus });
  const draw = (): void => {
    if (randomProblem) return;
    const result = generateRandomSequence(
      { ...randomRequest, zone: zonePercent / 100 },
      Math.random,
    );
    setFocus(result.focus);
    setSteps(result.steps);
    setFramesAspect(aspect);
    setWarnings(result.warnings);
    setDropped(0);
    setGenerated({ steps: stepCount, zoomStart: randomStart, zoomEnd: randomEnd });
    setSelected(0);
    touch();
  };
  const enterMode = (value: Mode): void => {
    setMode(value);
    // Entering Random mode on a picture with no sequence yet draws one right away;
    // an existing (for instance saved) sequence is never redrawn by switching modes.
    if (value === 'random' && steps.length === 0) draw();
  };

  const useLast = (): void => {
    if (!last) return;
    setStepCount(last.steps);
    setZoomStart(last.zoomStart);
    setZoomEnd(last.zoomEnd);
    setAspect(last.aspect);
    touch();
  };

  const update = (index: number, change: (step: StepDraft) => StepDraft): void => {
    setSteps(steps.map((step, position) => (position === index ? change(step) : step)));
    touch();
  };
  const editRect = (index: number, rect: Rect): void => {
    update(index, (step) => ({ ...step, rect, manual: true }));
  };
  const insertAt = (index: number, step: StepDraft): void => {
    setSteps([...steps.slice(0, index), step, ...steps.slice(index)]);
    setSelected(index);
    touch();
  };
  const remove = (index: number): void => {
    setSteps(steps.filter((_step, position) => position !== index));
    setSelected(Math.max(0, Math.min(index, steps.length - 2)));
    touch();
  };
  const swap = (index: number, other: number): void => {
    if (other < 0 || other >= steps.length) return;
    const next = [...steps];
    [next[index], next[other]] = [next[other] as StepDraft, next[index] as StepDraft];
    setSteps(next);
    setSelected(other);
    touch();
  };

  const save = useAdminMutation(
    () =>
      adminApi.saveSequence(image.id, {
        aspect: framesAspect ?? aspect,
        params: { focus, ...generated },
        steps: steps.map((step) => ({ name: step.name, rect: step.rect, manual: step.manual })),
      }),
    () => {
      rememberSettings({ ...generated, aspect: framesAspect ?? aspect });
      setDirty(false);
      setJustSaved(true);
    },
  );
  const canSave = steps.length > 0 && !framesStale && !save.isPending;

  const saveAndAdd = (): void => {
    save.mutate(undefined, {
      onSuccess: () => {
        void navigate(`/admin/images?characterId=${image.characterId}&add=1`);
      },
    });
  };

  const previewKeys = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowLeft') setSelected(Math.max(0, selected - 1));
    else if (event.key === 'ArrowRight') setSelected(Math.min(steps.length - 1, selected + 1));
    else return;
    event.preventDefault();
  };

  const stepName = (step: StepDraft, index: number): string =>
    step.name ?? t('steps.defaultName', { n: index + 1 });

  const warningText = (warning: GenerationWarning): string =>
    t(`warnings.${warning.code}`, {
      steps: warning.steps.map((step) => step + 1).join(', '),
    });

  const stepsField = (
    <Field label={t('simple.steps')} hint={t('simple.stepsHint', { max: MAX_STEPS })}>
      <Input
        name="step-count"
        type="number"
        min={1}
        max={MAX_STEPS}
        step={1}
        value={stepCount}
        onChange={(event) => {
          setStepCount(Math.round(toNumber(event.target.value, DEFAULT_STEPS)));
          touch();
        }}
      />
    </Field>
  );
  const aspectField = (
    <Field label={t('simple.aspect')}>
      <Select
        name="aspect"
        value={aspectKey(aspect)}
        onChange={(event) => {
          setAspect(
            ASPECT_PRESETS.find((preset) => aspectKey(preset) === event.target.value) ??
              DEFAULT_ASPECT,
          );
          touch();
        }}
      >
        {ASPECT_PRESETS.map((preset) => (
          <option key={aspectKey(preset)} value={aspectKey(preset)}>
            {aspectKey(preset)}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* ------------------------------------------------ source picture */}
        <div className="space-y-4">
          <SourceCanvas
            src={imageUrl(image.id, 'display')}
            image={size}
            ratio={ratio}
            focus={focus}
            onFocusChange={(point) => {
              setFocus(point);
              touch();
            }}
            rect={mode === 'advanced' && current ? current.rect : null}
            frameEditable={mode === 'advanced' && current !== undefined}
            onRectChange={(rect) => {
              editRect(selected, rect);
            }}
          />
          <p className="text-sm text-fg-muted">{t('simple.focusHint')}</p>
          <div className="grid max-w-sm grid-cols-2 gap-3">
            <Field label={t('simple.focusX')}>
              <Input
                name="focus-x"
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={percent(focus.x)}
                onChange={(event) => {
                  setFocus({
                    ...focus,
                    x: Math.min(1, Math.max(0, toNumber(event.target.value, 50) / 100)),
                  });
                  touch();
                }}
              />
            </Field>
            <Field label={t('simple.focusY')}>
              <Input
                name="focus-y"
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={percent(focus.y)}
                onChange={(event) => {
                  setFocus({
                    ...focus,
                    y: Math.min(1, Math.max(0, toNumber(event.target.value, 50) / 100)),
                  });
                  touch();
                }}
              />
            </Field>
          </div>
        </div>

        {/* ------------------------------------------------ preview */}
        <Card>
          <CardTitle>{t('preview.title')}</CardTitle>
          {current ? (
            <div
              className="space-y-3"
              onKeyDown={previewKeys}
              role="group"
              aria-label={t('preview.region')}
              tabIndex={0}
            >
              <FrameView
                src={imageUrl(image.id, 'display')}
                rect={current.rect}
                aspect={frameAspect}
                label={t('preview.frameLabel', { name: stepName(current, selected) })}
                className="w-full rounded-control border border-line"
              />
              <div className="flex items-center justify-between gap-2">
                <Button
                  disabled={selected <= 0}
                  onClick={() => {
                    setSelected(selected - 1);
                  }}
                >
                  {t('preview.previous')}
                </Button>
                <p
                  className="text-center text-sm"
                  aria-live="polite"
                  data-testid="preview-position"
                >
                  <span className="font-medium">{stepName(current, selected)}</span>
                  <br />
                  <span className="text-fg-muted">
                    {t('preview.position', { n: selected + 1, total: steps.length })}
                  </span>
                </p>
                <Button
                  disabled={selected >= steps.length - 1}
                  onClick={() => {
                    setSelected(selected + 1);
                  }}
                >
                  {t('preview.next')}
                </Button>
              </div>
              <p className="text-xs text-fg-muted">
                {t('preview.zoom', {
                  zoom: zoomOfRect(size, aspectRatio(frameAspect), current.rect).toFixed(2),
                })}
                {current.manual && (
                  <>
                    {' '}
                    · <Badge tone="warning">{t('steps.manual')}</Badge>
                  </>
                )}
              </p>
            </div>
          ) : (
            <p className="text-sm text-fg-muted">{t('preview.empty')}</p>
          )}
        </Card>
      </div>

      {/* ------------------------------------------------ step strip */}
      {steps.length > 0 && (
        <nav aria-label={t('strip.label')} className="overflow-x-auto pb-2">
          <ol className="flex gap-2">
            {steps.map((step, index) => (
              <li key={index} className="w-32 shrink-0">
                <button
                  type="button"
                  aria-current={index === selected ? 'step' : undefined}
                  aria-label={t('strip.select', { name: stepName(step, index) })}
                  onClick={() => {
                    setSelected(index);
                  }}
                  className={`block w-full rounded-control border-2 p-0.5 text-left ${
                    index === selected ? 'border-accent-text' : 'border-line'
                  }`}
                >
                  <FrameView
                    src={imageUrl(image.id, 'display')}
                    rect={step.rect}
                    aspect={frameAspect}
                    label=""
                    className="w-full"
                  />
                  <span className="mt-1 block truncate px-1 text-xs text-fg-soft">
                    {stepName(step, index)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      )}

      {/* ------------------------------------------------ settings */}
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{t(`${mode}.title`)}</CardTitle>
          <div role="group" aria-label={t('mode.label')} className="flex gap-1">
            {MODES.map((value) => (
              <Button
                key={value}
                variant={mode === value ? 'primary' : 'secondary'}
                aria-pressed={mode === value}
                onClick={() => {
                  enterMode(value);
                }}
              >
                {t(`mode.${value}`)}
              </Button>
            ))}
          </div>
        </div>

        {mode === 'random' ? (
          <div className="space-y-3">
            <p className="text-sm text-fg-muted">{t('random.hint')}</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-start">
              {stepsField}
              <Field label={t('random.zoomStart')} hint={t('random.zoomStartHint')}>
                <Input
                  name="random-zoom-start"
                  type="number"
                  min={MIN_ZOOM}
                  max={zoomLimit}
                  step={0.1}
                  value={randomStart}
                  onChange={(event) => {
                    setRandomStart(toNumber(event.target.value, randomStart));
                  }}
                />
              </Field>
              <Field label={t('random.zoomEnd')} hint={t('random.zoomEndHint')}>
                <Input
                  name="random-zoom-end"
                  type="number"
                  min={MIN_ZOOM}
                  max={zoomLimit}
                  step={0.1}
                  value={randomEnd}
                  onChange={(event) => {
                    setRandomEnd(toNumber(event.target.value, randomEnd));
                  }}
                />
              </Field>
              <Field label={t('random.zone')} hint={t('random.zoneHint', { zone: zonePercent })}>
                <Input
                  name="random-zone"
                  type="number"
                  min={MIN_RANDOM_ZONE * 100}
                  max={MAX_RANDOM_ZONE * 100}
                  step={5}
                  value={zonePercent}
                  onChange={(event) => {
                    setZonePercent(toNumber(event.target.value, zonePercent));
                  }}
                />
              </Field>
              {aspectField}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Button
                variant="primary"
                disabled={randomProblem !== null}
                onClick={draw}
                data-testid="relaunch"
              >
                {t('random.relaunch')}
              </Button>
              <p className="text-sm text-fg-muted" aria-live="polite" data-testid="drawn-focus">
                {t('random.focusDrawn', {
                  x: Math.round(focus.x * 100),
                  y: Math.round(focus.y * 100),
                })}
              </p>
            </div>
            <p className="text-xs text-fg-muted">{t('random.fixed')}</p>
            {hasManual && <Notice tone="warning">{t('random.replacesManual')}</Notice>}
            {randomProblem !== null && (
              <Notice tone="warning">{t(`problems.${randomProblem}`, { max: MAX_STEPS })}</Notice>
            )}
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
              {stepsField}
              <Field label={t('simple.zoomStart')} hint={t('simple.zoomStartHint')}>
                <Input
                  name="zoom-start"
                  type="number"
                  min={MIN_ZOOM}
                  max={zoomLimit}
                  step={0.1}
                  value={zoomStart}
                  onChange={(event) => {
                    setZoomStart(toNumber(event.target.value, zoomStart));
                    touch();
                  }}
                />
              </Field>
              <Field label={t('simple.zoomEnd')} hint={t('simple.zoomEndHint')}>
                <Input
                  name="zoom-end"
                  type="number"
                  min={MIN_ZOOM}
                  max={zoomLimit}
                  step={0.1}
                  value={zoomEnd}
                  onChange={(event) => {
                    setZoomEnd(toNumber(event.target.value, zoomEnd));
                    touch();
                  }}
                />
              </Field>
              {aspectField}
              <Button
                variant="primary"
                disabled={problem !== null}
                onClick={generate}
                data-testid="generate"
              >
                {t('simple.generate')}
              </Button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
              {last && (
                <Button variant="ghost" onClick={useLast}>
                  {t('simple.useLast', {
                    steps: last.steps,
                    start: last.zoomStart,
                    end: last.zoomEnd,
                  })}
                </Button>
              )}
              {hasManual && !framesStale && (
                <Checkbox
                  name="preserve-manual"
                  checked={preserve}
                  onChange={(event) => {
                    setPreserve(event.target.checked);
                  }}
                  label={t('simple.preserve')}
                />
              )}
            </div>
          </>
        )}

        <div className="mt-3 space-y-2">
          {problem !== null && (
            <Notice tone="warning">{t(`problems.${problem}`, { max: MAX_STEPS })}</Notice>
          )}
          {framesStale && <Notice tone="warning">{t('simple.staleRatio')}</Notice>}
          {warnings.map((warning) => (
            <Notice key={warning.code} tone="neutral">
              {warningText(warning)}
            </Notice>
          ))}
          {dropped > 0 && (
            <Notice tone="warning">{t('warnings.MANUAL_DROPPED', { count: dropped })}</Notice>
          )}
        </div>
      </Card>

      {/* ------------------------------------------------ advanced mode */}
      {mode === 'advanced' && (
        <Card>
          <CardTitle>{t('advanced.stepsTitle')}</CardTitle>
          {steps.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('advanced.noSteps')}</p>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <ol className="max-h-96 space-y-1 overflow-y-auto pr-1" aria-label={t('strip.label')}>
                {steps.map((step, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(index);
                      }}
                      aria-current={index === selected ? 'true' : undefined}
                      className={`flex w-full items-center justify-between gap-2 rounded-control px-3 py-1.5 text-left text-sm ${
                        index === selected
                          ? 'bg-surface-sunken text-fg'
                          : 'text-fg-soft hover:bg-surface-sunken'
                      }`}
                    >
                      <span className="truncate">{stepName(step, index)}</span>
                      {step.manual && <Badge tone="warning">{t('steps.manual')}</Badge>}
                    </button>
                  </li>
                ))}
              </ol>

              {current && (
                <div className="space-y-4">
                  <Field label={t('advanced.stepName')} hint={t('advanced.stepNameHint')}>
                    <Input
                      name="step-name"
                      maxLength={80}
                      placeholder={t('steps.defaultName', { n: selected + 1 })}
                      value={current.name ?? ''}
                      onChange={(event) => {
                        update(selected, (step) => ({
                          ...step,
                          name: event.target.value === '' ? null : event.target.value,
                        }));
                      }}
                    />
                  </Field>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label={t('advanced.frameX')}>
                      <Input
                        name="frame-x"
                        type="number"
                        step={0.5}
                        min={0}
                        max={100}
                        value={percent(rectCenter(current.rect).x)}
                        onChange={(event) => {
                          editRect(
                            selected,
                            centerRect(current.rect, {
                              x: toNumber(event.target.value, 50) / 100,
                              y: rectCenter(current.rect).y,
                            }),
                          );
                        }}
                      />
                    </Field>
                    <Field label={t('advanced.frameY')}>
                      <Input
                        name="frame-y"
                        type="number"
                        step={0.5}
                        min={0}
                        max={100}
                        value={percent(rectCenter(current.rect).y)}
                        onChange={(event) => {
                          editRect(
                            selected,
                            centerRect(current.rect, {
                              x: rectCenter(current.rect).x,
                              y: toNumber(event.target.value, 50) / 100,
                            }),
                          );
                        }}
                      />
                    </Field>
                    <Field label={t('advanced.frameZoom')}>
                      <Input
                        name="frame-zoom"
                        type="number"
                        step={0.1}
                        min={MIN_ZOOM}
                        max={zoomLimit}
                        value={
                          Math.round(
                            zoomOfRect(size, aspectRatio(frameAspect), current.rect) * 100,
                          ) / 100
                        }
                        onChange={(event) => {
                          editRect(
                            selected,
                            zoomRect(
                              size,
                              aspectRatio(frameAspect),
                              current.rect,
                              toNumber(event.target.value, 1),
                            ),
                          );
                        }}
                      />
                    </Field>
                  </div>
                  <p className="text-xs text-fg-muted">{t('advanced.frameHint')}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => {
                        insertAt(selected + 1, {
                          name: null,
                          rect: fitFrame(size, aspectRatio(frameAspect), focus),
                          manual: true,
                        });
                      }}
                    >
                      {t('advanced.add')}
                    </Button>
                    <Button
                      onClick={() => {
                        insertAt(selected + 1, { ...current, manual: true });
                      }}
                    >
                      {t('advanced.duplicate')}
                    </Button>
                    <Button
                      disabled={selected === 0}
                      onClick={() => {
                        swap(selected, selected - 1);
                      }}
                    >
                      {t('advanced.moveUp')}
                    </Button>
                    <Button
                      disabled={selected >= steps.length - 1}
                      onClick={() => {
                        swap(selected, selected + 1);
                      }}
                    >
                      {t('advanced.moveDown')}
                    </Button>
                    <Button
                      variant="danger"
                      disabled={steps.length <= 1}
                      onClick={() => {
                        remove(selected);
                      }}
                    >
                      {t('advanced.remove')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* ------------------------------------------------ save */}
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            disabled={!canSave}
            onClick={() => {
              save.mutate(undefined);
            }}
            data-testid="save-sequence"
          >
            {t('save.save')}
          </Button>
          <Button disabled={!canSave} onClick={saveAndAdd}>
            {t('save.saveAndAdd')}
          </Button>
          {dirty && <Badge tone="warning">{t('save.unsaved')}</Badge>}
          {justSaved && !dirty && <Badge tone="success">{t('save.saved')}</Badge>}
        </div>
        {(image.review === 'APPROVED_NEUTRAL' || image.review === 'APPROVED_SENSITIVE') && (
          <p className="mt-3 text-sm text-fg-muted">{t('save.withdrawsApproval')}</p>
        )}
        <div className="mt-3">
          <ErrorNotice error={save.error} />
        </div>
      </Card>

      <ReviewPanel image={image} dirty={dirty || steps.length === 0} />
    </div>
  );
}
