import {
  aspectRatio,
  buildSteps,
  DEFAULT_ASPECT,
  type CharacterDto,
  type ImageDetailDto,
  type ImageDto,
  type SaveSequenceRequest,
} from '@app/shared';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { makeImage } from './fixtures';
import { createReviewedUniverse, type Client } from './helpers';

/** A reviewed general-audience universe and one character in it. */
export async function setupCharacter(admin: Client, name = 'Ashe') {
  const universe = await createReviewedUniverse(admin, 'League of Legends');
  const response = await admin.post('/characters', {
    universeId: universe.id,
    names: { en: name },
  });
  return { universe, character: response.json<CharacterDto>() };
}

export async function importPicture(
  admin: Client,
  characterId: string,
  options: { width?: number; height?: number; seed?: number; filename?: string } = {},
): Promise<ImageDto> {
  const { width = 1215, height = 717, seed = 0, filename = 'splash.png' } = options;
  const response = await admin.upload(
    `/characters/${characterId}/images`,
    filename,
    await makeImage({ width, height, seed }),
    'image/png',
  );
  if (response.statusCode !== 200) throw new Error(`import failed: ${response.body}`);
  return response.json<ImageDto>();
}

/** A sequence body as the editor would send it, generated with the shared generator. */
export function sequenceBody(
  image: Pick<ImageDto, 'width' | 'height'>,
  steps = 5,
  overrides: Partial<SaveSequenceRequest> = {},
): SaveSequenceRequest {
  const aspect = overrides.aspect ?? DEFAULT_ASPECT;
  const focus = { x: 0.6, y: 0.4 };
  const built = buildSteps({
    image,
    ratio: aspectRatio(aspect),
    focus,
    start: { kind: 'zoom', zoom: 6 },
    end: { kind: 'zoom', zoom: 1 },
    steps,
  });
  return {
    aspect,
    params: { focus, steps, zoomStart: 6, zoomEnd: 1 },
    steps: built.steps.map((step) => ({ name: step.name, rect: step.rect, manual: step.manual })),
    ...overrides,
  };
}

export async function saveSequenceOf(
  admin: Client,
  image: Pick<ImageDto, 'id' | 'width' | 'height'>,
  steps = 5,
): Promise<ImageDetailDto> {
  const response = await admin.put(`/images/${image.id}/sequence`, sequenceBody(image, steps));
  if (response.statusCode !== 200) throw new Error(`sequence failed: ${response.body}`);
  return response.json<ImageDetailDto>();
}

/** Every file below a directory, as paths relative to it. */
export async function listFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else found.push(path.relative(root, full));
    }
  };
  await walk(root);
  return found.sort();
}
