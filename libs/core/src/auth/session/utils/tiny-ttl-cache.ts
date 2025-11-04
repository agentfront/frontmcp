// auth/session/utils/tiny-ttl-cache.ts
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
}
