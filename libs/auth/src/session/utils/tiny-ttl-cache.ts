/**
 * Tiny TTL Cache
 *
 * A simple in-memory cache with time-to-live expiration.
 */

export class TinyTtlCache<K, V> {
  private map = new Map<K, { v: V; exp: number }>();

  constructor(private readonly ttlMs: number) {}

  get(k: K): V | undefined {
    const hit = this.map.get(k);
    if (!hit) return undefined;
    if (hit.exp < Date.now()) {
      this.map.delete(k);
      return undefined;
    }
    return hit.v;
  }

  set(k: K, v: V) {
    this.map.set(k, { v, exp: Date.now() + this.ttlMs });
  }

  delete(k: K): boolean {
    return this.map.delete(k);
  }

  clear(): void {
    this.map.clear();
  }

  size(): number {
    return this.map.size;
  }

  /**
   * Remove all expired entries
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;
    for (const [k, { exp }] of this.map) {
      if (exp < now) {
        this.map.delete(k);
        removed++;
      }
    }
    return removed;
  }
}
