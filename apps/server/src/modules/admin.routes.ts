import {
  auditListQuerySchema,
  bulkCharacterStatusSchema,
  characterListQuerySchema,
  createCharacterSchema,
  createUniverseSchema,
  setBlockedModesSchema,
  setAudienceSchema,
  setCharacterStatusSchema,
  setClassificationSchema,
  unlockSensitiveSchema,
  updateCharacterLabelsSchema,
  updateUniverseSchema,
  variantSchema,
} from '@app/shared';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config';
import type { Db } from '../db';
import { parse } from '../errors';
import { listAudit, restoreAuditBatch, restoreAuditEntry } from './audit/service';
import { assertSameOrigin, loadAdmin, requireAdmin } from './auth/guard';
import { registerAuthRoutes, type AuthRouteOptions } from './auth/routes';
import { registerImageRoutes } from './images/routes';
import type { ImageDeps } from './images/service';
import { context, idOf } from './route-helpers';
import {
  bulkSetStatus,
  createCharacter,
  createVariant,
  deleteVariant,
  getCharacter,
  listCharacters,
  setBlockedModes,
  setClassification,
  setStatus,
  updateLabels,
  updateVariant,
} from './catalog/characters.service';
import {
  createUniverse,
  listUniverses,
  lockSensitive,
  setAudience,
  unlockSensitive,
  updateUniverse,
} from './catalog/universes.service';

/**
 * Everything under `/api/admin`. Two hooks protect the whole scope:
 * the origin check (CSRF) and the session lookup. Every route except login
 * and logout then requires an authenticated administrator.
 */
export function registerAdminRoutes(
  app: FastifyInstance,
  db: Db,
  config: AppConfig,
  images: ImageDeps,
  options: AuthRouteOptions = {},
): void {
  app.addHook('onRequest', async (request, reply) => {
    // Never let a proxy or the browser cache administrative data.
    void reply.header('cache-control', 'no-store');
    assertSameOrigin(request, config);
    await loadAdmin(request, db, config);
  });

  registerAuthRoutes(app, db, config, options);

  void app.register((secured, _opts, done) => {
    secured.addHook('preHandler', (request, _reply, next) => {
      requireAdmin(request);
      next();
    });

    // Universes
    secured.get('/universes', () => listUniverses(db));
    secured.post('/universes', (request) =>
      createUniverse(db, context(request), parse(createUniverseSchema, request.body)),
    );
    secured.put('/universes/:id', (request) =>
      updateUniverse(
        db,
        context(request),
        idOf(request),
        parse(updateUniverseSchema, request.body),
      ),
    );
    secured.put('/universes/:id/audience', (request) =>
      setAudience(db, context(request), idOf(request), parse(setAudienceSchema, request.body)),
    );
    secured.put('/universes/:id/sensitive-unlock', (request) =>
      unlockSensitive(
        db,
        context(request),
        idOf(request),
        parse(unlockSensitiveSchema, request.body),
      ),
    );
    secured.delete('/universes/:id/sensitive-unlock', (request) =>
      lockSensitive(db, context(request), idOf(request)),
    );

    // Characters
    secured.get('/characters', (request) =>
      listCharacters(db, parse(characterListQuerySchema, request.query)),
    );
    secured.post('/characters', (request) =>
      createCharacter(db, context(request), parse(createCharacterSchema, request.body)),
    );
    secured.get('/characters/:id', (request) => getCharacter(db, idOf(request)));
    secured.put('/characters/:id/labels', (request) =>
      updateLabels(
        db,
        context(request),
        idOf(request),
        parse(updateCharacterLabelsSchema, request.body),
      ),
    );
    secured.put('/characters/:id/status', (request) =>
      setStatus(
        db,
        context(request),
        idOf(request),
        parse(setCharacterStatusSchema, request.body).status,
      ),
    );
    secured.post('/characters/bulk-status', (request) => {
      const body = parse(bulkCharacterStatusSchema, request.body);
      return bulkSetStatus(db, context(request), body.ids, body.status);
    });
    secured.put('/characters/:id/classification', (request) =>
      setClassification(
        db,
        context(request),
        idOf(request),
        parse(setClassificationSchema, request.body),
      ),
    );
    secured.put('/characters/:id/blocked-modes', (request) =>
      setBlockedModes(
        db,
        context(request),
        idOf(request),
        parse(setBlockedModesSchema, request.body).modeIds,
      ),
    );

    // Variants
    secured.post('/characters/:id/variants', (request) =>
      createVariant(db, context(request), idOf(request), parse(variantSchema, request.body)),
    );
    secured.put('/variants/:id', (request) =>
      updateVariant(db, context(request), idOf(request), parse(variantSchema, request.body)),
    );
    secured.delete('/variants/:id', (request) =>
      deleteVariant(db, context(request), idOf(request)),
    );

    registerImageRoutes(secured, images, config);

    // History
    secured.get('/audit', (request) => listAudit(db, parse(auditListQuerySchema, request.query)));
    secured.post('/audit/:id/restore', async (request) => {
      await restoreAuditEntry(db, context(request), idOf(request));
      return { ok: true };
    });
    secured.post('/audit/batches/:id/restore', (request) =>
      restoreAuditBatch(db, context(request), idOf(request)),
    );

    done();
  });
}
