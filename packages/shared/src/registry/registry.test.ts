import { describe, expect, it } from 'vitest';
import { findGameBySlug, GAME_IDS, GAMES } from './games';
import { isModeId, MODE_IDS, MODES } from './modes';

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe('mode registry', () => {
  it('uses stable kebab-case identifiers matching their keys', () => {
    for (const id of MODE_IDS) {
      expect(id).toMatch(ID_PATTERN);
      expect(MODES[id].id).toBe(id);
    }
  });

  it('marks the historic mode, and only it, as sensitive', () => {
    const sensitive = MODE_IDS.filter((id) => MODES[id].sensitivity === 'sensitive');
    expect(sensitive).toEqual(['historic']);
  });

  it('validates mode identifiers', () => {
    expect(isModeId('zoom-out')).toBe(true);
    expect(isModeId('Laketduku')).toBe(false);
  });
});

describe('game registry', () => {
  it('references known modes and has unique slugs', () => {
    const slugs = GAME_IDS.map((id) => GAMES[id].slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const id of GAME_IDS) {
      expect(GAMES[id].id).toBe(id);
      expect(GAMES[id].slug).toMatch(ID_PATTERN);
      for (const modeId of GAMES[id].modeIds) expect(isModeId(modeId)).toBe(true);
    }
  });

  it('finds games by slug', () => {
    expect(findGameBySlug('gaming-quiz')?.id).toBe('gaming-quiz');
    expect(findGameBySlug('unknown')).toBeUndefined();
  });
});
