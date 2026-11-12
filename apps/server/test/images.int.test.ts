import type { CharacterDto, ImageDto, Page } from '@app/shared';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeImage } from './fixtures';
import { importPicture, listFiles, setupCharacter } from './image-helpers';
import {
  adminClient,
  client,
  multipartBody,
  startApp,
  WEB_ORIGIN,
  type Client,
  type TestContext,
} from './helpers';
import { createLimiter, labelFromFilename } from '../src/modules/images/processing';
import { FileStorage } from '../src/modules/images/storage';

let context: TestContext;
let admin: Client;
let characterId: string;

async function boot(env: Record<string, string> = {}) {
  context = await startApp({}, env);
  admin = await adminClient(context);
  characterId = (await setupCharacter(admin)).character.id;
}

const upload = (filename: string, content: Buffer, type = 'image/png', id = characterId) =>
  admin.upload(`/characters/${id}/images`, filename, content, type);

const rowCount = () => context.db.asset.count();
const storedFiles = () => listFiles(context.storageDir);

beforeEach(async () => {
  await boot();
});
afterEach(async () => {
  await context.close();
});

describe('a valid import', () => {
  it.each(['png', 'jpeg', 'webp'] as const)('accepts %s and starts UNVERIFIED', async (format) => {
    const response = await upload(
      `ahri.${format}`,
      await makeImage({ width: 1215, height: 717, format }),
      `image/${format}`,
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<ImageDto>()).toMatchObject({
      characterId,
      width: 1215,
      height: 717,
      sourceFormat: format,
      review: 'UNVERIFIED',
      reviewedAt: null,
      hasSequence: false,
      stepCount: 0,
      label: 'ahri',
    });
  });

  it('stores three files under random names, in the private storage only', async () => {
    const image = await importPicture(admin, characterId);
    const files = await storedFiles();
    expect(files).toHaveLength(3);
    for (const file of files)
      expect(file).toMatch(/^(original|display|thumb)\/[a-f0-9]{32}\.webp$/);
    expect(new Set(files.map((file) => file.split('/')[1])).size).toBe(1); // one key for the three files
    const row = await context.db.asset.findUniqueOrThrow({ where: { id: image.id } });
    expect(files.every((file) => file.includes(row.storageKey))).toBe(true);
    // Nothing of the client's file name reaches the disk.
    expect(files.join('')).not.toContain('splash');
  });

  it('keeps the original size, makes smaller derived versions and strips every piece of metadata', async () => {
    const picture = await makeImage({
      width: 3000,
      height: 1688,
      format: 'jpeg',
      secret: 'SECRET-GPS-OWNER',
    });
    expect((await sharp(picture).metadata()).exif).toBeDefined();
    const image = (await upload('big.jpg', picture, 'image/jpeg')).json<ImageDto>();

    const key = (await context.db.asset.findUniqueOrThrow({ where: { id: image.id } })).storageKey;
    const read = async (kind: string) =>
      readFile(path.join(context.storageDir, kind, `${key}.webp`));
    const [original, display, thumb] = await Promise.all([
      read('original'),
      read('display'),
      read('thumb'),
    ]);

    const sizes = await Promise.all(
      [original, display, thumb].map((file) => sharp(file).metadata()),
    );
    expect([sizes[0]?.width, sizes[0]?.height]).toEqual([3000, 1688]);
    expect(Math.max(sizes[1]?.width ?? 0, sizes[1]?.height ?? 0)).toBe(1600);
    expect(Math.max(sizes[2]?.width ?? 0, sizes[2]?.height ?? 0)).toBe(320);
    for (const [index, meta] of sizes.entries()) {
      expect(meta.format).toBe('webp');
      expect(meta.exif, `file ${index}`).toBeUndefined();
      expect(meta.icc, `file ${index}`).toBeUndefined();
      expect(meta.xmp, `file ${index}`).toBeUndefined();
    }
    for (const file of [original, display, thumb])
      expect(file.includes('SECRET-GPS-OWNER')).toBe(false);
    expect(image.bytes).toBe(original.length);
    expect(thumb.length).toBeLessThan(display.length);
  });

  it('applies the orientation of the file before dropping it', async () => {
    const picture = await makeImage({ width: 1600, height: 900, format: 'jpeg', orientation: 6 });
    const image = (await upload('rotated.jpg', picture, 'image/jpeg')).json<ImageDto>();
    expect([image.width, image.height]).toEqual([900, 1600]);
  });

  it('drops anything appended after the picture', async () => {
    const marker = Buffer.from('<?php system($_GET["c"]); ?>');
    const polyglot = Buffer.concat([await makeImage({ width: 600, height: 400 }), marker]);
    const response = await upload('innocent.png', polyglot);
    expect(response.statusCode).toBe(200);
    for (const file of await storedFiles()) {
      expect((await readFile(path.join(context.storageDir, file))).includes(marker)).toBe(false);
    }
  });

  it('refuses the same file twice for one character, but accepts it for another', async () => {
    const picture = await makeImage({ width: 800, height: 600, seed: 3 });
    expect((await upload('a.png', picture)).statusCode).toBe(200);
    const duplicate = await upload('renamed.png', picture);
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toEqual({ error: { code: 'DUPLICATE_IMAGE' } });
    expect(await rowCount()).toBe(1);
    expect(await storedFiles()).toHaveLength(3);

    const other = (await setupOther()).id;
    expect((await upload('a.png', picture, 'image/png', other)).statusCode).toBe(200);
    expect(await rowCount()).toBe(2);
  });

  it('records the import in the history of the character', async () => {
    const image = await importPicture(admin, characterId, { filename: 'ashe.png' });
    const history = (await admin.get(`/audit?entityId=${characterId}`)).json<
      Page<{ action: string; restorable: boolean; after: { assetId: string } }>
    >();
    const entry = history.items.find((item) => item.action === 'image.import');
    expect(entry?.after.assetId).toBe(image.id);
    expect(entry?.restorable).toBe(false);
  });
});

async function setupOther(): Promise<CharacterDto> {
  const universes = (await admin.get('/universes')).json<{ id: string }[]>();
  const response = await admin.post('/characters', {
    universeId: universes[0]?.id,
    names: { en: 'Irelia' },
  });
  return response.json<CharacterDto>();
}

describe('invalid imports', () => {
  const refused = async (
    response: { statusCode: number; json: () => unknown },
    status: number,
    code: string,
  ) => {
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ error: { code } });
    expect(await rowCount()).toBe(0);
    expect(await storedFiles()).toEqual([]);
  };

  it('refuses a file that is not a picture, whatever its name and declared type say', async () => {
    await refused(
      await upload('photo.png', Buffer.from('just some text, not a picture')),
      422,
      'INVALID_IMAGE',
    );
    await refused(
      await upload('photo.jpg', Buffer.alloc(2000), 'image/jpeg'),
      422,
      'INVALID_IMAGE',
    );
  });

  it('refuses a truncated picture', async () => {
    const picture = await makeImage({ width: 800, height: 600, format: 'jpeg' });
    await refused(
      await upload('cut.jpg', picture.subarray(0, Math.floor(picture.length / 3)), 'image/jpeg'),
      422,
      'INVALID_IMAGE',
    );
  });

  it('refuses formats that are not accepted: SVG, GIF', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><script>alert(1)</script></svg>',
    );
    await refused(await upload('x.svg', svg, 'image/svg+xml'), 422, 'INVALID_IMAGE');
    const gif = await sharp({
      create: { width: 400, height: 400, channels: 3, background: '#f00' },
    })
      .gif()
      .toBuffer();
    await refused(await upload('x.gif', gif, 'image/gif'), 422, 'INVALID_IMAGE');
  });

  it('refuses an animated picture', async () => {
    const frame = (red: number) =>
      sharp({
        create: { width: 400, height: 400, channels: 3, background: { r: red, g: 0, b: 0 } },
      })
        .png()
        .toBuffer();
    const animated = await sharp(await Promise.all([frame(10), frame(200)]), {
      join: { animated: true },
    })
      .webp()
      .toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(2);
    await refused(await upload('anim.webp', animated, 'image/webp'), 422, 'INVALID_IMAGE');
  });

  it('refuses a picture that is too small', async () => {
    await refused(
      await upload('tiny.png', await makeImage({ width: 200, height: 200 })),
      422,
      'INVALID_IMAGE',
    );
  });

  it('refuses a request without a file, or that is not multipart', async () => {
    const empty = multipartBody('x.png', Buffer.alloc(0));
    const noFile = await context.app.inject({
      method: 'POST',
      url: `/api/admin/characters/${characterId}/images`,
      headers: {
        origin: WEB_ORIGIN,
        cookie: adminCookie(),
        'content-type': empty.headers['content-type'] ?? '',
      },
      payload: `--${(empty.headers['content-type'] ?? '').split('boundary=')[1]}--\r\n`,
    });
    expect(noFile.statusCode).toBe(400);
    const json = await admin.post(`/characters/${characterId}/images`, { hello: 'world' });
    expect(json.statusCode).toBe(400);
    expect(await rowCount()).toBe(0);
  });

  it('answers 404 for an unknown character and stores nothing', async () => {
    await refused(
      await upload('a.png', await makeImage({ width: 600, height: 400 }), 'image/png', 'missing'),
      404,
      'NOT_FOUND',
    );
  });
});

let cookieJar = '';
function adminCookie(): string {
  return cookieJar;
}
beforeEach(async () => {
  const login = await context.app.inject({
    method: 'POST',
    url: '/api/admin/auth/login',
    headers: { origin: WEB_ORIGIN },
    payload: { username: 'admin', password: 'correct horse battery staple' },
  });
  const cookie = login.cookies.find((entry) => entry.name === 'admin_session');
  cookieJar = cookie ? `${cookie.name}=${cookie.value}` : '';
});

describe('limits', () => {
  it('refuses a file above the size limit with a clear code, before storing anything', async () => {
    await context.close();
    await boot({ UPLOAD_MAX_BYTES: '5000', IMAGE_MIN_SIDE: '24' });
    const noisy = await sharp(randomBytes(300 * 300 * 3), {
      raw: { width: 300, height: 300, channels: 3 },
    })
      .png()
      .toBuffer();
    expect(noisy.length).toBeGreaterThan(5000);
    const response = await upload('noise.png', noisy);
    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({ error: { code: 'FILE_TOO_LARGE' } });
    expect(await rowCount()).toBe(0);
    expect(await storedFiles()).toEqual([]);
  });

  it('refuses a picture with too many pixels without decoding it', async () => {
    await context.close();
    await boot({ IMAGE_MAX_PIXELS: '1000000' });
    const response = await upload(
      'wide.png',
      await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#123' } })
        .png()
        .toBuffer(),
    );
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: { code: 'INVALID_IMAGE' } });
    expect(await rowCount()).toBe(0);
  });

  it('accepts a high-resolution picture within the limits', async () => {
    const started = Date.now();
    const image = await importPicture(admin, characterId, { width: 6000, height: 3375 });
    expect(image.width).toBe(6000);
    expect(Date.now() - started).toBeLessThan(30_000);
  });

  it('runs at most the configured number of image tasks at once, in order', async () => {
    const run = createLimiter(2);
    let active = 0;
    let peak = 0;
    const order: number[] = [];
    await Promise.all(
      Array.from({ length: 8 }, (_unused, index) =>
        run(async () => {
          active += 1;
          peak = Math.max(peak, active);
          order.push(index);
          await new Promise((resolve) => setTimeout(resolve, 10));
          active -= 1;
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('editor pages', () => {
  it('can load a picture hundreds of times in a minute without being rate limited', async () => {
    const image = await importPicture(admin, characterId);
    // A hundred-step strip asks for the same file a hundred times, and a few pages do that in a row.
    const statuses: number[] = [];
    for (let batch = 0; batch < 4; batch += 1) {
      const responses = await Promise.all(
        Array.from({ length: 100 }, () => admin.get(`/images/${image.id}/file/display`)),
      );
      statuses.push(...responses.map((response) => response.statusCode));
    }
    expect(statuses).toHaveLength(400);
    expect(new Set(statuses)).toEqual(new Set([200]));
    // The rest of the API still has its own quota.
    expect((await admin.get(`/images/${image.id}`)).statusCode).toBe(200);
  });
});

describe('access control', () => {
  it('refuses every image route without a session, and a forged origin', async () => {
    const image = await importPicture(admin, characterId);
    const anonymous = client(context.app);
    const checks = [
      anonymous.get('/images'),
      anonymous.get(`/images/${image.id}`),
      anonymous.get(`/images/${image.id}/file/thumb`),
      anonymous.get(`/images/${image.id}/file/display`),
      anonymous.get(`/images/${image.id}/file/original`),
      anonymous.put(`/images/${image.id}/sequence`, {}),
      anonymous.put(`/images/${image.id}/review`, { review: 'APPROVED_NEUTRAL' }),
      anonymous.delete(`/images/${image.id}`),
      anonymous.upload(
        `/characters/${characterId}/images`,
        'a.png',
        await makeImage({ width: 600, height: 400, seed: 9 }),
      ),
    ];
    for (const response of await Promise.all(checks)) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: { code: 'UNAUTHENTICATED' } });
    }
    expect(await rowCount()).toBe(1);

    const form = multipartBody('a.png', await makeImage({ width: 600, height: 400, seed: 10 }));
    const forged = await context.app.inject({
      method: 'POST',
      url: `/api/admin/characters/${characterId}/images`,
      headers: { origin: 'https://evil.example', cookie: adminCookie(), ...form.headers },
      payload: form.body,
    });
    expect(forged.statusCode).toBe(403);
    expect(await rowCount()).toBe(1);
  });

  it('never serves an image to a forged or expired session', async () => {
    const image = await importPicture(admin, characterId);
    const forged = client(context.app, 'admin_session=not-a-real-token');
    expect((await forged.get(`/images/${image.id}/file/original`)).statusCode).toBe(401);
  });
});

describe('files', () => {
  it('serves the three versions to an administrator, privately, with revalidation', async () => {
    const image = await importPicture(admin, characterId);
    for (const kind of ['thumb', 'display', 'original']) {
      const response = await admin.get(`/images/${image.id}/file/${kind}`);
      expect(response.statusCode, kind).toBe(200);
      expect(response.headers['content-type']).toBe('image/webp');
      expect(response.headers['cache-control']).toBe('private, no-cache');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect((await sharp(response.rawPayload).metadata()).format).toBe('webp');

      const etag = String(response.headers.etag);
      const again = await context.app.inject({
        method: 'GET',
        url: `/api/admin/images/${image.id}/file/${kind}`,
        headers: { origin: WEB_ORIGIN, cookie: adminCookie(), 'if-none-match': etag },
      });
      expect(again.statusCode).toBe(304);
    }
  });

  it('rejects unknown kinds and malicious identifiers', async () => {
    const image = await importPicture(admin, characterId);
    for (const url of [
      `/images/${image.id}/file/secret`,
      `/images/${image.id}/file/..%2f..%2fetc%2fpasswd`,
      `/images/..%2f..%2f..%2fetc%2fpasswd/file/original`,
      `/images/%2e%2e/file/original`,
      `/images/${image.id}%00/file/original`,
      '/images/missing/file/original',
    ]) {
      const response = await admin.get(url);
      expect([400, 404], url).toContain(response.statusCode);
      expect(response.headers['content-type'], url).not.toBe('image/webp');
    }
  });

  it('only ever builds paths from random keys', async () => {
    const storage = new FileStorage(context.storageDir);
    for (const key of [
      '../../etc/passwd',
      '..',
      '/etc/passwd',
      'A'.repeat(32),
      'g'.repeat(32),
      'a'.repeat(31),
      `${'a'.repeat(31)}/`,
      '',
    ]) {
      await expect(storage.write('original', key, Buffer.from('x'))).rejects.toThrow(
        'invalid storage key',
      );
      expect(() => storage.open('original', key)).toThrow('invalid storage key');
    }
    await expect(storage.removeByName('original', '../x.webp')).rejects.toThrow();
    await expect(
      storage.write('../etc' as 'original', 'a'.repeat(32).replace(/a/g, 'b'), Buffer.from('x')),
    ).rejects.toThrow();
  });

  it('does not use a hostile file name as a path, and cleans it for display', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'lkd-parent-'));
    try {
      const before = await listFiles(os.tmpdir()).then((files) =>
        files.filter((file) => file.includes('passwd')),
      );
      const image = (
        await upload(
          '../../../etc/passwd\u202egnp.png',
          await makeImage({ width: 600, height: 400 }),
        )
      ).json<ImageDto>();
      expect(image.label).not.toContain('/');
      expect(image.label).not.toContain('\u202e');
      expect(labelFromFilename('C:\\Users\\Lucas\\Splash Arts\\Ahri_0.jpg')).toBe('Ahri_0');
      expect(labelFromFilename('   ')).toBe('image');
      expect(labelFromFilename('a'.repeat(500) + '.png')).toHaveLength(120);
      for (const file of await storedFiles())
        expect(file).toMatch(/^(original|display|thumb)\/[a-f0-9]{32}\.webp$/);
      const after = await listFiles(os.tmpdir()).then((files) =>
        files.filter((file) => file.includes('passwd')),
      );
      expect(after).toEqual(before);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});

describe('failures leave nothing behind', () => {
  it('records exactly one image, and keeps exactly three files, when the same file arrives twice at once', async () => {
    const picture = await makeImage({ width: 900, height: 600, seed: 5 });
    const responses = await Promise.all([
      upload('a.png', picture),
      upload('b.png', picture),
      upload('c.png', picture),
    ]);
    const statuses = responses.map((response) => response.statusCode).sort();
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(2);
    expect(await rowCount()).toBe(1);
    expect(await storedFiles()).toHaveLength(3);
  });

  it('records nothing and removes its files when the storage cannot be written', async () => {
    await context.close();
    const blocker = path.join(
      await mkdtemp(path.join(os.tmpdir(), 'lkd-block-')),
      'not-a-directory',
    );
    await writeFile(blocker, 'a file where the storage directory should be');
    await boot({ STORAGE_DIR: blocker });
    const response = await upload('a.png', await makeImage({ width: 600, height: 400 }));
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: { code: 'INTERNAL_ERROR' } });
    expect(await rowCount()).toBe(0);
    await rm(path.dirname(blocker), { recursive: true, force: true });
  });

  it('lets many imports in a row succeed', async () => {
    const results = [];
    for (let seed = 0; seed < 8; seed += 1) {
      results.push(
        await importPicture(admin, characterId, {
          seed,
          width: 1215,
          height: 717,
          filename: `splash ${seed}.png`,
        }),
      );
    }
    expect(new Set(results.map((image) => image.id)).size).toBe(8);
    expect(await storedFiles()).toHaveLength(24);
  });
});

describe('listing', () => {
  it('lists newest first, filters by character and review, and pages', async () => {
    const other = await setupOther();
    const first = await importPicture(admin, characterId, { seed: 1 });
    const second = await importPicture(admin, other.id, { seed: 2 });
    const third = await importPicture(admin, characterId, { seed: 3 });

    const all = (await admin.get('/images')).json<Page<ImageDto>>();
    expect(all.items.map((image) => image.id)).toEqual([third.id, second.id, first.id]);
    expect(all.items[0]).toMatchObject({
      universeName: 'League of Legends',
      characterNames: { en: 'Ashe' },
    });

    const mine = (await admin.get(`/images?characterId=${characterId}`)).json<Page<ImageDto>>();
    expect(mine.total).toBe(2);
    const paged = (await admin.get('/images?pageSize=2&page=2')).json<Page<ImageDto>>();
    expect(paged.items.map((image) => image.id)).toEqual([first.id]);
    expect((await admin.get('/images?review=REJECTED')).json<Page<ImageDto>>().total).toBe(0);
    expect((await admin.get('/images?pageSize=500')).statusCode).toBe(400);
  });

  it('shows the real images in the character summary', async () => {
    await importPicture(admin, characterId, { seed: 1 });
    await importPicture(admin, characterId, { seed: 2 });
    const character = (await admin.get(`/characters/${characterId}`)).json<CharacterDto>();
    expect(character.images).toMatchObject({ total: 2, unverified: 2, approvedNeutral: 0 });
    // Unverified images are never usable.
    expect(character.usableImages['zoom-out']).toBe(0);
  });
});
