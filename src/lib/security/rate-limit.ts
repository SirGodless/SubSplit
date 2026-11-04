/** Einfaches In-Memory-Fenster pro Schlüssel (reicht für eine einzelne Instanz). */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Zählt einen Versuch; false, wenn das Limit überschritten ist. */
  consume(key: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((x) => x > t - this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.sweep(t);
    return true;
  }

  private sweep(t: number) {
    for (const [k, v] of this.hits) if (v.every((x) => x <= t - this.windowMs)) this.hits.delete(k);
  }
}
