import {
  imageFileParamsSchema,
  imageListQuerySchema,
  reviewImageSchema,
  saveSequenceSchema,
} from '@app/shared';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../config';
import { invalid, parse } from '../../errors';
import { context, idOf } from '../route-helpers';
import {
  deleteImage,
  getImage,
  importImage,
  listImages,
  openImageFile,
  reviewImage,
  saveSequence,
  type ImageDeps,
} from './service';

/**
 * Image routes, registered inside the secured admin scope: every one of them
 * requires a signed-in administrator, and state-changing ones also pass the
 * origin check. Files are only ever sent through `GET .../file/:kind`.
 */
export function registerImageRoutes(
  secured: FastifyInstance,
  deps: ImageDeps,
  config: AppConfig,
): void {
  secured.get('/images', (request) =>
    listImages(deps.db, parse(imageListQuerySchema, request.query)),
  );
  secured.get('/images/:id', (request) => getImage(deps.db, idOf(request)));

  secured.post(
    '/characters/:id/images',
    {
      // Above the upload limit the request is refused before it is read.
      bodyLimit: config.UPLOAD_MAX_BYTES + 1024 * 1024,
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (request) => {
      const characterId = idOf(request);
      if (!request.isMultipart()) throw invalid();
      const file = await request.file({
        limits: { fileSize: config.UPLOAD_MAX_BYTES, files: 1, fields: 0 },
      });
      if (!file) throw invalid();
      const bytes = await file.toBuffer();
      return importImage(deps, context(request), characterId, { filename: file.filename, bytes });
    },
  );

  secured.put('/images/:id/sequence', (request) =>
    saveSequence(deps, context(request), idOf(request), parse(saveSequenceSchema, request.body)),
  );
  secured.put('/images/:id/review', (request) =>
    reviewImage(deps, context(request), idOf(request), parse(reviewImageSchema, request.body)),
  );
  secured.delete('/images/:id', async (request) => {
    await deleteImage(deps, context(request), idOf(request));
    return { ok: true };
  });

  // An editor page asks for the same picture once per step shown (up to a hundred): this route
  // has its own, higher limit so that it never starves the rest of the API of its quota.
  secured.get(
    '/images/:id/file/:kind',
    { config: { rateLimit: { max: 3000, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { id, kind } = parse(imageFileParamsSchema, request.params);
      const file = await openImageFile(deps, id, kind);
      if (request.headers['if-none-match'] === file.etag) {
        file.stream.destroy();
        return reply.status(304).send();
      }
      return (
        reply
          .header('content-type', 'image/webp')
          .header('content-length', file.size)
          .header('etag', file.etag)
          // Private to this browser and revalidated every time: signing out closes access at once.
          .header('cache-control', 'private, no-cache')
          .send(file.stream)
      );
    },
  );
}
