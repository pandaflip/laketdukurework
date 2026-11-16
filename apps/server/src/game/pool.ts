import { matchesFilter, selectStepIndices, type ModeId, type RoomConfig } from '@app/shared';
import type { Db } from '../db';
import type { FileStorage } from '../modules/images/storage';
import { AnswerIndex } from './answers';
import { loadCandidates, loadCatalog, type Candidate } from './candidates';
import { ZoomOutClues } from './clues/zoom-out';
import { drawOrder, type Random } from './deck';
import type { AnswerKey, ChallengeSource, PreparedChallenge } from './types';

export interface PoolDeps {
  readonly db: Db;
  readonly storage: FileStorage;
  readonly limit: <T>(task: () => Promise<T>) => Promise<T>;
  readonly random: Random;
}

/**
 * The challenges of one game. Opening the pool lists what the host's filters
 * leave (that is the number shown in the lobby and checked before starting);
 * each `next()` then draws the following image and checks it AGAIN against the
 * stored data, so something rejected or withdrawn since the start is skipped.
 */
export class ChallengePool implements ChallengeSource {
  private readonly order: Candidate[];
  private cursor = 0;

  private constructor(
    private readonly deps: PoolDeps,
    private readonly config: RoomConfig,
    private readonly answers: AnswerIndex,
    order: Candidate[],
  ) {
    this.order = order;
  }

  static async open(deps: PoolDeps, config: RoomConfig): Promise<ChallengePool> {
    const modeId: ModeId = config.modeId;
    const catalog = await loadCatalog(deps.db);
    const answers = new AnswerIndex(catalog.labels);
    const candidates = (await loadCandidates(deps.db, modeId)).filter(
      (candidate) =>
        matchesFilter(config.filter, candidate) && answers.isAnswerable(candidate.characterId),
    );
    return new ChallengePool(deps, config, answers, drawOrder(candidates, deps.random));
  }

  /** How many different challenges the game can draw from. */
  get size(): number {
    return this.order.length;
  }

  async next(): Promise<PreparedChallenge | null> {
    while (this.cursor < this.order.length) {
      const drawn = this.order[this.cursor++];
      if (!drawn) break;
      const prepared = await this.prepare(drawn).catch(() => null);
      if (prepared) return prepared;
    }
    return null;
  }

  private async prepare(drawn: Candidate): Promise<PreparedChallenge | null> {
    const { db, storage, limit } = this.deps;
    // Evaluated again now: approval, status, classification and frames may have changed.
    const [fresh] = await loadCandidates(db, this.config.modeId, drawn.assetId);
    if (!fresh || fresh.characterId !== drawn.characterId) return null;
    if (!matchesFilter(this.config.filter, fresh)) return null;
    if (!this.answers.isAnswerable(fresh.characterId)) return null;

    const indices = selectStepIndices(fresh.rects.length, this.config.steps);
    const clues = new ZoomOutClues({
      storage,
      storageKey: fresh.storageKey,
      width: fresh.width,
      height: fresh.height,
      rects: indices.flatMap((index) => {
        const rect = fresh.rects[index];
        return rect ? [rect] : [];
      }),
      limit,
    });
    try {
      await clues.render(0); // the round only starts once its first picture exists
    } catch {
      clues.release();
      return null;
    }
    clues.prefetch();

    const answers = this.answers;
    const characterId = fresh.characterId;
    const answer: AnswerKey = {
      names: fresh.names,
      universe: fresh.universeName,
      accepts: (text, options) => answers.matches(characterId, text, options),
      isRelated: (text) => answers.isRelated(characterId, text),
    };
    return { clues, answer };
  }
}
