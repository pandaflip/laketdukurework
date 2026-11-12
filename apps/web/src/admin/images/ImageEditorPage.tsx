import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { Notice } from '../../design/ui';
import { adminApi } from '../../lib/api';
import { ErrorNotice, localizedName } from '../shared';
import { ReviewBadge } from './ReviewPanel';
import { SequenceEditor } from './SequenceEditor';

export function ImageEditorPage() {
  const { t } = useTranslation('images');
  const { id = '' } = useParams();
  const image = useQuery({ queryKey: ['admin', 'image', id], queryFn: () => adminApi.image(id) });

  if (image.isPending) return <Notice>{t('loading')}</Notice>;
  if (image.isError) return <ErrorNotice error={image.error} />;
  const data = image.data;

  return (
    <div className="space-y-6">
      <div>
        <Link
          to={`/admin/images?characterId=${data.characterId}`}
          className="text-sm text-accent-text hover:underline"
        >
          ← {t('editor.back')}
        </Link>
        <h1 className="mt-2 font-display text-2xl font-bold">
          {localizedName(data.characterNames)} <span className="text-fg-muted">· {data.label}</span>
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          <span>{data.universeName}</span>·
          <span>{t('list.size', { width: data.width, height: data.height })}</span>·
          <ReviewBadge review={data.review} />
          <Link
            to={`/admin/characters/${data.characterId}`}
            className="text-accent-text hover:underline"
          >
            {t('editor.characterPage')}
          </Link>
        </p>
      </div>
      {/* Keyed by image: the editor keeps its own working state while the data refreshes. */}
      <SequenceEditor key={data.id} image={data} />
    </div>
  );
}
