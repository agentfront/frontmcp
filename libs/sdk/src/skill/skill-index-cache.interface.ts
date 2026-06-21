/**
 * Pluggable cache for a skill provider's built search index (the TF-IDF / BM25
 * "embedding" model + per-skill vectors).
 *
 * Building the index means tokenizing every skill, computing IDF across the
 * corpus, and embedding each document. On a long-lived server that happens once;
 * on a serverless/edge runtime (Cloudflare Workers) it happens on EVERY cold
 * start. This cache lets a host persist the built index (e.g. to Cloudflare KV)
 * keyed by a content hash of the indexed skills, so a cold start can restore the
 * index instead of recomputing it — a large cold-start win for big catalogs.
 *
 * Implementations only round-trip an opaque, JSON-safe snapshot (`unknown`); the
 * provider owns its shape (it is the vector DB's snapshot). The cache key is a
 * stable hash of the indexed skill set + scoring mode, so changing the skills or
 * scoring naturally invalidates the entry.
 */
export interface SkillIndexCache {
  /**
   * Return the cached snapshot for `key`, or `undefined` on a miss. MUST treat a
   * corrupt/unparseable entry as a miss (resolve `undefined`) rather than throw —
   * a bad cache entry should degrade to a rebuild, never brick search.
   */
  get(key: string): Promise<unknown | undefined>;
  /** Persist `snapshot` under `key`. Failures should be swallowed (best-effort). */
  set(key: string, snapshot: unknown): Promise<void>;
}

/**
 * Ranking function for the skill search index.
 * - `cosine` (default): cosine similarity over normalized TF-IDF vectors.
 * - `bm25`: Okapi BM25 — term-saturating, length-normalized relevance.
 */
export type SkillIndexScoring = 'cosine' | 'bm25';
