// file: libs/sdk/src/skill/decision/skill-decision.ranker.ts

import { sha256Hex } from '@frontmcp/utils';

import type { SkillSearchResult } from '../skill-storage.interface';
import type { SkillDecision, SkillDecisionCandidate, SkillDecisionOptions } from './skill-decision.types';

/** The Decisions API takes 2 to 255 choices; one of them is "none of these". */
export const MAX_DECISION_CANDIDATES = 254;

const DEFAULTS = { maxCandidates: 50, minProbability: 0.1, timeoutMs: 5000, ttlMs: 600_000, maxEntries: 500 };

function isProbability(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

interface CachedDecision {
  expiresAt: number;
  decisions: SkillDecision[];
}

/**
 * Ranks skill search results with a decision model (`skillsConfig.decision`): the index supplies the candidates, the
 * {@link SkillDecisionOptions.decider} a probability for each, and results are ranked by it. Decisions are cached
 * per query, anti-query and candidate set.
 */
export class SkillDecisionRanker {
  readonly maxCandidates: number;
  private readonly minProbability: number;
  private readonly timeoutMs: number;
  private readonly cache?: { ttlMs: number; maxEntries: number; entries: Map<string, CachedDecision> };

  constructor(
    private readonly options: SkillDecisionOptions,
    private readonly logger: { warn(message: string, meta?: Record<string, unknown>): void },
  ) {
    this.maxCandidates = Math.min(
      Math.max(options.maxCandidates ?? DEFAULTS.maxCandidates, 1),
      MAX_DECISION_CANDIDATES,
    );
    this.minProbability = options.minProbability ?? DEFAULTS.minProbability;
    this.timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
    if (options.cache !== false) {
      this.cache = {
        ttlMs: options.cache?.ttlMs ?? DEFAULTS.ttlMs,
        maxEntries: options.cache?.maxEntries ?? DEFAULTS.maxEntries,
        entries: new Map(),
      };
    }
  }

  /**
   * `pool`, the index's candidates, ranked by the decision model: each scored by its probability, those under
   * `minProbability` left out, at most `topK`. `undefined` when the model failed, timed out or was refused (logged),
   * for the caller to keep the index's ranking.
   */
  async rank(
    query: string,
    negativeQuery: string | string[] | undefined,
    pool: readonly SkillSearchResult[],
    topK?: number,
  ): Promise<SkillSearchResult[] | undefined> {
    const candidatePool = pool.slice(0, this.maxCandidates);
    if (candidatePool.length === 0) return [];
    const notQuery =
      negativeQuery === undefined ? [] : typeof negativeQuery === 'string' ? [negativeQuery] : negativeQuery;
    const candidates: SkillDecisionCandidate[] = candidatePool.map((r) => ({
      id: r.metadata.id ?? r.metadata.name,
      name: r.metadata.name,
      description: r.metadata.description ?? '',
      ...(r.metadata.tags?.length ? { tags: [...r.metadata.tags] } : {}),
    }));

    const decisions = await this.decide(query, notQuery, candidates);
    if (!decisions) return undefined;

    const probabilityOf = new Map(decisions.map((d) => [d.id, d.probability]));
    const ranked = candidatePool
      .map((result, i) => ({ ...result, score: probabilityOf.get(candidates[i].id) ?? 0 }))
      .filter((result) => result.score >= this.minProbability)
      .sort((a, b) => b.score - a.score);
    return typeof topK === 'number' && topK >= 0 ? ranked.slice(0, topK) : ranked;
  }

  private async decide(
    query: string,
    notQuery: string[],
    candidates: SkillDecisionCandidate[],
  ): Promise<SkillDecision[] | undefined> {
    const key = this.cache ? sha256Hex(JSON.stringify([query, notQuery, candidates])) : '';
    const cached = this.cache?.entries.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.decisions;

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A decider that ignores the signal still gives way to the timeout.
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`no decision within ${this.timeoutMs} ms`));
      }, this.timeoutMs);
    });
    let decisions: SkillDecision[];
    try {
      decisions = await Promise.race([
        this.options.decider({ query, notQuery, candidates, signal: controller.signal }),
        timeout,
      ]);
      const invalid = decisions.find((decision) => !isProbability(decision.probability));
      if (invalid) throw new Error(`the decision for "${invalid.id}" has no probability from 0 to 1`);
    } catch (error) {
      this.logger.warn('skill search: the decision model failed; results are ranked by the index', {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    } finally {
      clearTimeout(timer);
    }

    if (this.cache) {
      this.cache.entries.delete(key);
      this.cache.entries.set(key, { expiresAt: Date.now() + this.cache.ttlMs, decisions });
      while (this.cache.entries.size > this.cache.maxEntries) {
        const oldest = this.cache.entries.keys().next().value;
        if (oldest === undefined) break;
        this.cache.entries.delete(oldest);
      }
    }
    return decisions;
  }
}
