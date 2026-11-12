import {
  SENSITIVE_APPROVAL_NOTE_MIN_LENGTH,
  type ApprovalBlocker,
  type AssetReview,
  type ImageDetailDto,
} from '@app/shared';
import { useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Badge, Button, Card, CardTitle, Checkbox, Field, Notice, Textarea } from '../../design/ui';
import { adminApi } from '../../lib/api';
import { ErrorNotice, useAdminMutation } from '../shared';

const TONE = {
  UNVERIFIED: 'neutral',
  APPROVED_NEUTRAL: 'success',
  APPROVED_SENSITIVE: 'warning',
  REJECTED: 'danger',
} as const;

export function ReviewBadge({ review }: { review: AssetReview }) {
  const { t } = useTranslation('images');
  return <Badge tone={TONE[review]}>{t(`review.${review}`)}</Badge>;
}

function Blockers({ blockers }: { blockers: readonly ApprovalBlocker[] }) {
  const { t } = useTranslation(['images', 'admin']);
  if (blockers.length === 0) return null;
  return (
    <ul className="list-inside list-disc text-xs text-fg-muted">
      {blockers.map((blocker) => (
        <li key={blocker}>
          {blocker === 'SEQUENCE_REQUIRED'
            ? t('images:review.SEQUENCE_REQUIRED')
            : t(`admin:reasons.${blocker}`)}
        </li>
      ))}
    </ul>
  );
}

/**
 * Approve, reject or reset the saved version of an image. What is allowed is
 * computed by the server (the same rules it enforces on the request), so
 * buttons that would be refused are disabled with their reasons.
 */
export function ReviewPanel({ image, dirty }: { image: ImageDetailDto; dirty: boolean }) {
  const { t } = useTranslation('images');
  const navigate = useNavigate();
  const [sensitiveForm, setSensitiveForm] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState('');
  const [deleting, setDeleting] = useState(false);

  const review = useAdminMutation(
    (body: { review: AssetReview; note?: string; confirm?: boolean }) =>
      adminApi.reviewImage(image.id, {
        review: body.review,
        note: body.note ?? '',
        ...(body.confirm ? { confirm: true } : {}),
      }),
  );
  const remove = useAdminMutation(
    () => adminApi.deleteImage(image.id),
    undefined,
    // Leave first: this image no longer exists, so its page must not reload.
    () => {
      void navigate(`/admin/images?characterId=${image.characterId}`);
    },
  );

  const { neutral, sensitive } = image.approval;
  const locked = dirty || review.isPending;

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <CardTitle>{t('review.title')}</CardTitle>
        <ReviewBadge review={image.review} />
      </div>
      <p className="mb-4 text-sm text-fg-muted">{t('review.intro')}</p>
      {dirty && <Notice tone="warning">{t('review.saveFirst')}</Notice>}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Button
            variant="primary"
            disabled={locked || !neutral.allowed || image.review === 'APPROVED_NEUTRAL'}
            onClick={() => {
              review.mutate({ review: 'APPROVED_NEUTRAL' });
            }}
            data-testid="approve-neutral"
          >
            {t('review.approveNeutral')}
          </Button>
          <Blockers blockers={neutral.blockers} />
        </div>
        <div className="space-y-2">
          <Button
            disabled={locked || !sensitive.allowed || image.review === 'APPROVED_SENSITIVE'}
            onClick={() => {
              setSensitiveForm(!sensitiveForm);
            }}
            aria-expanded={sensitiveForm}
            data-testid="approve-sensitive"
          >
            {t('review.approveSensitive')}
          </Button>
          <Blockers blockers={sensitive.blockers} />
        </div>
      </div>

      {sensitiveForm && sensitive.allowed && (
        <form
          className="mt-4 space-y-3 rounded-control border border-warning p-4"
          onSubmit={(event: SyntheticEvent) => {
            event.preventDefault();
            review.mutate(
              { review: 'APPROVED_SENSITIVE', note, confirm },
              {
                onSuccess: () => {
                  setSensitiveForm(false);
                  setConfirm(false);
                  setNote('');
                },
              },
            );
          }}
        >
          <p className="text-sm text-fg-soft">{t('review.sensitiveIntro')}</p>
          <Field
            label={t('review.note')}
            hint={t('review.noteHint', { count: SENSITIVE_APPROVAL_NOTE_MIN_LENGTH })}
          >
            <Textarea
              name="approval-note"
              required
              minLength={SENSITIVE_APPROVAL_NOTE_MIN_LENGTH}
              maxLength={1000}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          </Field>
          <Checkbox
            name="approval-confirm"
            required
            checked={confirm}
            onChange={(event) => {
              setConfirm(event.target.checked);
            }}
            label={t('review.confirmSensitive')}
          />
          <Button type="submit" variant="primary" disabled={review.isPending}>
            {t('review.confirmApprove')}
          </Button>
        </form>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="danger"
          disabled={locked || image.review === 'REJECTED'}
          onClick={() => {
            review.mutate({ review: 'REJECTED' });
          }}
          data-testid="reject"
        >
          {t('review.reject')}
        </Button>
        <Button
          disabled={locked || image.review === 'UNVERIFIED'}
          onClick={() => {
            review.mutate({ review: 'UNVERIFIED' });
          }}
        >
          {t('review.reset')}
        </Button>
        {image.nextId !== null ? (
          <Link
            to={`/admin/images/${image.nextId}`}
            className="inline-flex items-center rounded-control border border-line-strong bg-surface-raised px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-sunken"
            data-testid="next-image"
          >
            {t('review.next')}
          </Link>
        ) : (
          <span className="inline-flex items-center px-3 py-1.5 text-sm text-fg-muted">
            {t('review.noNext')}
          </span>
        )}
      </div>
      <div className="mt-3">
        <ErrorNotice error={review.error} />
      </div>

      <div className="mt-6 border-t border-line pt-4">
        {deleting ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-fg-soft">{t('delete.confirm')}</p>
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() => {
                remove.mutate(undefined);
              }}
              data-testid="confirm-delete"
            >
              {t('delete.yes')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setDeleting(false);
              }}
            >
              {t('delete.no')}
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            onClick={() => {
              setDeleting(true);
            }}
          >
            {t('delete.action')}
          </Button>
        )}
        <div className="mt-2">
          <ErrorNotice error={remove.error} />
        </div>
      </div>
    </Card>
  );
}
