import type { LocalizedNames } from '@app/shared';

/** A picture ready to be sent to players. Metadata-free, already cropped. */
export interface RenderedClue {
  readonly bytes: Buffer;
  readonly contentType: 'image/webp';
}

/**
 * How the clues of one round are shown. The engine only knows how MANY clues
 * there are and asks for one when it reveals it: what a clue is (a frame of a
 * picture for Zoom Out, a pixelated version, a silhouette...) belongs to the
 * mode. A clue is never rendered for a player before it is revealed.
 */
export interface ClueSource {
  readonly count: number;
  render(index: number): Promise<RenderedClue>;
  /** The whole picture, shown once the round is over. */
  renderReveal(): Promise<RenderedClue>;
  /** Frees whatever the round held in memory. */
  release(): void;
}

export interface AnswerOptions {
  readonly typoTolerance: boolean;
  readonly aliases: boolean;
}

/**
 * The expected answer of a round. Never leaves the server before the round
 * is over: views are built from `names` only at the reveal.
 */
export interface AnswerKey {
  readonly names: LocalizedNames;
  readonly universe: string;
  /** Whether a typed answer is right under the host's options. */
  accepts(text: string, options: AnswerOptions): boolean;
  /**
   * Whether a typed answer is a name, an alias or a typo of the expected
   * answer, whatever the host's options: such an answer is never displayed to
   * the other players, even when it was refused.
   */
  isRelated(text: string): boolean;
}

/** One round: what is shown, and what answers it. Prepared before the round starts. */
export interface PreparedChallenge {
  readonly clues: ClueSource;
  readonly answer: AnswerKey;
}

/** Where the rounds of a game come from; `null` means nothing eligible is left. */
export interface ChallengeSource {
  next(): Promise<PreparedChallenge | null>;
}
