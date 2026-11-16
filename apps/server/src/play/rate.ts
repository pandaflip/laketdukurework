/**
 * A token bucket on the real clock: `perSecond` messages a second, with room
 * for a burst of `burst`. Used per connection, so one noisy client cannot
 * take anything from the others.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly perSecond: number,
    private readonly burst: number,
    private readonly clock: () => number = () => performance.now(),
  ) {
    this.tokens = burst;
    this.last = clock();
  }

  take(): boolean {
    const now = this.clock();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
