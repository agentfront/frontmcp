import { MAX_DECISION_CANDIDATES, SkillDecisionRanker, type SkillDecider } from '../decision';
import type { SkillSearchResult } from '../skill-storage.interface';

const result = (id: string, score = 0.2, tags?: string[]): SkillSearchResult => ({
  metadata: { id, name: id, description: `${id} skill`, instructions: '', ...(tags ? { tags } : {}) },
  score,
  availableTools: [],
  missingTools: [],
  source: 'local',
});

const pool = [result('store', 0.4), result('pet-catalog', 0), result('orders', 0.1, ['admin'])];
const logger = () => ({ warn: jest.fn() });

describe('SkillDecisionRanker (#1062)', () => {
  it('ranks the candidates by probability, leaving out those under minProbability, at most topK', async () => {
    const decider: SkillDecider = jest.fn(async () => [
      { id: 'pet-catalog', probability: 0.8 },
      { id: 'store', probability: 0.15 },
      { id: 'orders', probability: 0.05 },
    ]);
    const ranker = new SkillDecisionRanker({ decider }, logger());

    const ranked = await ranker.rank('kittens', undefined, pool);
    expect(ranked?.map((r) => [r.metadata.id, r.score])).toEqual([
      ['pet-catalog', 0.8],
      ['store', 0.15],
    ]);
    expect((await ranker.rank('kittens', undefined, pool, 1))?.map((r) => r.metadata.id)).toEqual(['pet-catalog']);
  });

  it('gives the decider the candidates, with their tags, and the anti-query as a list', async () => {
    const decider = jest.fn<ReturnType<SkillDecider>, Parameters<SkillDecider>>(async () => []);
    await new SkillDecisionRanker({ decider }, logger()).rank('q', 'stock', pool);

    const request = decider.mock.calls[0][0];
    expect(request.notQuery).toEqual(['stock']);
    expect(request.candidates).toEqual([
      { id: 'store', name: 'store', description: 'store skill' },
      { id: 'pet-catalog', name: 'pet-catalog', description: 'pet-catalog skill' },
      { id: 'orders', name: 'orders', description: 'orders skill', tags: ['admin'] },
    ]);
  });

  it('chooses among at most maxCandidates, capped at the 254 the Decisions API takes', async () => {
    const decider = jest.fn<ReturnType<SkillDecider>, Parameters<SkillDecider>>(async () => []);
    await new SkillDecisionRanker({ decider, maxCandidates: 2 }, logger()).rank('q', undefined, pool);
    expect(decider.mock.calls[0][0].candidates.map((c) => c.id)).toEqual(['store', 'pet-catalog']);
    expect(new SkillDecisionRanker({ decider, maxCandidates: 1000 }, logger()).maxCandidates).toBe(
      MAX_DECISION_CANDIDATES,
    );
  });

  it('answers a repeated search from its cache, and asks again when the candidates change', async () => {
    const decider = jest.fn(async () => [{ id: 'store', probability: 0.9 }]);
    const ranker = new SkillDecisionRanker({ decider }, logger());

    await ranker.rank('order', undefined, pool);
    await ranker.rank('order', undefined, pool);
    expect(decider).toHaveBeenCalledTimes(1);

    await ranker.rank('order', undefined, pool.slice(0, 2));
    await ranker.rank('order', 'stock', pool);
    expect(decider).toHaveBeenCalledTimes(3);
  });

  it('asks again once a cached decision expires, or with the cache off', async () => {
    const now = jest.spyOn(Date, 'now');
    try {
      now.mockReturnValue(1_000);
      const decider = jest.fn(async () => [{ id: 'store', probability: 0.9 }]);
      const ranker = new SkillDecisionRanker({ decider, cache: { ttlMs: 100 } }, logger());
      await ranker.rank('order', undefined, pool);
      now.mockReturnValue(1_050);
      await ranker.rank('order', undefined, pool);
      expect(decider).toHaveBeenCalledTimes(1);
      now.mockReturnValue(1_200);
      await ranker.rank('order', undefined, pool);
      expect(decider).toHaveBeenCalledTimes(2);

      const uncached = jest.fn(async () => [{ id: 'store', probability: 0.9 }]);
      const off = new SkillDecisionRanker({ decider: uncached, cache: false }, logger());
      await off.rank('order', undefined, pool);
      await off.rank('order', undefined, pool);
      expect(uncached).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });

  it('keeps at most maxEntries decisions, dropping the oldest', async () => {
    const decider = jest.fn(async () => [{ id: 'store', probability: 0.9 }]);
    const ranker = new SkillDecisionRanker({ decider, cache: { maxEntries: 2 } }, logger());

    for (const query of ['a', 'b', 'c']) await ranker.rank(query, undefined, pool);
    await ranker.rank('c', undefined, pool);
    expect(decider).toHaveBeenCalledTimes(3);
    await ranker.rank('a', undefined, pool);
    expect(decider).toHaveBeenCalledTimes(4);
  });

  it('answers undefined, for the index ranking, when the decider fails, and logs it', async () => {
    const log = logger();
    const ranker = new SkillDecisionRanker({ decider: async () => Promise.reject(new Error('rate limited')) }, log);

    expect(await ranker.rank('q', undefined, pool)).toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('the decision model failed'), {
      error: 'rate limited',
    });
  });

  it('gives up after timeoutMs, aborting the decision, even when the decider ignores the signal', async () => {
    let aborted = false;
    const log = logger();
    const ranker = new SkillDecisionRanker(
      {
        timeoutMs: 20,
        decider: ({ signal }) =>
          new Promise(() => {
            signal.addEventListener('abort', () => {
              aborted = true;
            });
          }),
      },
      log,
    );

    expect(await ranker.rank('q', undefined, pool)).toBeUndefined();
    expect(aborted).toBe(true);
    expect(log.warn).toHaveBeenCalledWith(expect.any(String), { error: 'no decision within 20 ms' });
  });

  it('makes no call for an empty pool', async () => {
    const decider = jest.fn(async () => []);
    expect(await new SkillDecisionRanker({ decider }, logger()).rank('q', undefined, [])).toEqual([]);
    expect(decider).not.toHaveBeenCalled();
  });
});
