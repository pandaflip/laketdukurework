import {
  MODE_IDS,
  MODES,
  normalizeName,
  type AgeClass,
  type Locale,
  type UniverseAudience,
} from '@app/shared';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config';
import { createDb, type Db } from '../db';

/**
 * Safe demonstration catalog: a handful of characters, no image. Universes get an explicit
 * audience classification; sensitive modes are enabled nowhere.
 *
 * Everything follows the defaults a real import would get: every character is
 * RESTRICTED and nobody is ADULT_VERIFIED, so no sensitive mode is playable
 * after seeding. Sensitive modes are not enabled for any universe either.
 */

const NEUTRAL_MODES = MODE_IDS.filter((id) => MODES[id].sensitivity === 'neutral');

interface SeedCharacter {
  slug: string;
  names: Partial<Record<Locale, string>> & { en: string };
  aliases?: Partial<Record<Locale, string[]>>;
  ageClass?: AgeClass;
  note?: string;
  variants?: { slug: string; names: Partial<Record<Locale, string>> & { en: string } }[];
}

const CATALOG: {
  slug: string;
  name: string;
  audience: Exclude<UniverseAudience, 'UNREVIEWED'>;
  characters: SeedCharacter[];
}[] = [
  {
    slug: 'league-of-legends',
    name: 'League of Legends',
    audience: 'GENERAL',
    characters: [
      {
        slug: 'ashe',
        names: { en: 'Ashe' },
        variants: [
          { slug: 'classic', names: { en: 'Classic', fr: 'Classique', 'pt-BR': 'Clássica' } },
        ],
      },
      {
        slug: 'irelia',
        names: { en: 'Irelia' },
        variants: [
          {
            slug: 'frostblade',
            names: { en: 'Frostblade', fr: 'Lame de glace', 'pt-BR': 'Lâmina Gélida' },
          },
        ],
      },
      { slug: 'miss-fortune', names: { en: 'Miss Fortune' }, aliases: { en: ['MF'] } },
      { slug: 'poppy', names: { en: 'Poppy' } },
      {
        slug: 'annie',
        names: { en: 'Annie' },
        ageClass: 'MINOR',
        note: 'Child character. Fundamental exclusion from sensitive modes.',
      },
      {
        slug: 'zoe',
        names: { en: 'Zoe', fr: 'Zoé' },
        ageClass: 'CHILDLIKE',
        note: 'Childlike appearance. Fundamental exclusion from sensitive modes.',
      },
    ],
  },
  {
    slug: 'valorant',
    name: 'Valorant',
    audience: 'GENERAL',
    characters: [
      { slug: 'jett', names: { en: 'Jett' } },
      { slug: 'sage', names: { en: 'Sage' } },
    ],
  },
  {
    slug: 'overwatch',
    name: 'Overwatch',
    audience: 'GENERAL',
    characters: [
      { slug: 'tracer', names: { en: 'Tracer' } },
      { slug: 'mercy', names: { en: 'Mercy', fr: 'Ange' } },
    ],
  },
  {
    slug: 'pokemon',
    name: 'Pokémon',
    audience: 'YOUTH',
    characters: [
      { slug: 'pikachu', names: { en: 'Pikachu' } },
      {
        slug: 'misty',
        names: { en: 'Misty', fr: 'Ondine' },
        ageClass: 'MINOR',
        note: 'Child character.',
      },
    ],
  },
  {
    slug: 'minecraft',
    name: 'Minecraft',
    audience: 'YOUTH',
    characters: [
      { slug: 'steve', names: { en: 'Steve' } },
      { slug: 'creeper', names: { en: 'Creeper' } },
    ],
  },
];

/** Idempotent: existing universes and characters are left untouched. */
export async function seedDemoCatalog(db: Db): Promise<{ universes: number; characters: number }> {
  let universes = 0;
  let characters = 0;

  for (const entry of CATALOG) {
    let universe = await db.universe.findUnique({ where: { slug: entry.slug } });
    if (!universe) {
      universe = await db.universe.create({
        data: {
          slug: entry.slug,
          name: entry.name,
          enabledModes: NEUTRAL_MODES,
          // Explicit demonstration classification. A real catalog starts UNREVIEWED.
          audience: entry.audience,
          audienceNote:
            'Demonstration seed: classified by the seed script, to review before real use.',
          audienceSetAt: new Date(),
        },
      });
      universes += 1;
    }

    for (const character of entry.characters) {
      const key = { universeId_slug: { universeId: universe.id, slug: character.slug } };
      if (await db.character.findUnique({ where: key })) continue;

      const labels = [
        ...Object.entries(character.names).map(([locale, value]) => ({
          locale,
          kind: 'NAME' as const,
          value,
          normalized: normalizeName(value),
        })),
        ...Object.entries(character.aliases ?? {}).flatMap(([locale, values]) =>
          values.map((value) => ({
            locale,
            kind: 'ALIAS' as const,
            value,
            normalized: normalizeName(value),
          })),
        ),
      ];

      await db.character.create({
        data: {
          universeId: universe.id,
          slug: character.slug,
          // Status is left to the database default (RESTRICTED).
          ...(character.ageClass === undefined ? {} : { ageClass: character.ageClass }),
          ...(character.note === undefined ? {} : { ageClassNote: character.note }),
          labels: { create: labels },
          variants: { create: character.variants ?? [] },
        },
      });
      characters += 1;
    }
  }
  return { universes, characters };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = createDb(loadConfig(process.env).DATABASE_URL);
  try {
    const result = await seedDemoCatalog(db);
    console.log(
      `Seed complete: ${result.universes} universes and ${result.characters} characters added.`,
    );
  } finally {
    await db.$disconnect();
  }
}
