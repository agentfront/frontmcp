// file: libs/plugins/src/codecall/__tests__/search-knowledge.tool.spec.ts

import type { SearchKnowledgeToolOutput } from '../tools/search-knowledge.schema';
import SearchKnowledgeTool from '../tools/search-knowledge.tool';

jest.mock('@frontmcp/sdk', () => ({
  Tool: () => (target: unknown) => target,
  ToolContext: class MockToolContext {
    private services = new Map<unknown, unknown>();
    public scope: Record<string, unknown> = {};

    constructor(_args?: unknown) {
      // intentionally empty
    }

    get(token: unknown): unknown {
      return this.services.get(token);
    }
  },
}));

function entry(name: string, knowledge: boolean) {
  return {
    name,
    isExecutable: () => !knowledge,
    isKnowledgeOnly: () => knowledge,
  };
}

function knowledgeMeta() {
  return {
    name: 'refund-policy',
    description: 'When a refund is eligible',
    tags: ['billing', 'policy'],
  };
}

describe('SearchKnowledgeTool', () => {
  let tool: SearchKnowledgeTool & {
    scope: { skills: { getKnowledgeOnlySkills: jest.Mock; search: jest.Mock } };
  };
  let mockRegistry: { getKnowledgeOnlySkills: jest.Mock; search: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRegistry = {
      getKnowledgeOnlySkills: jest.fn(),
      search: jest.fn(),
    };

    tool = new (SearchKnowledgeTool as any)();
    tool.scope = { skills: mockRegistry } as never;
  });

  it('returns ranked knowledge-only skills', async () => {
    mockRegistry.getKnowledgeOnlySkills.mockReturnValue([entry('refund-policy', true)]);
    mockRegistry.search.mockResolvedValueOnce([
      { metadata: knowledgeMeta(), score: 0.78, availableTools: [], missingTools: [], source: 'local' as const },
    ]);

    const result: SearchKnowledgeToolOutput = await tool.execute({ queries: ['refund eligibility'] });

    expect(result.knowledge).toHaveLength(1);
    expect(result.knowledge[0]).toMatchObject({
      name: 'refund-policy',
      description: 'When a refund is eligible',
      tags: ['billing', 'policy'],
      relevanceScore: 0.78,
      matchedQueries: ['refund eligibility'],
    });
    expect(result.totalKnowledgeSkills).toBe(1);
  });

  it('filters out executable skills returned by the underlying search', async () => {
    mockRegistry.getKnowledgeOnlySkills.mockReturnValue([entry('refund-policy', true)]);
    mockRegistry.search.mockResolvedValueOnce([
      { metadata: knowledgeMeta(), score: 0.8, availableTools: [], missingTools: [], source: 'local' as const },
      {
        metadata: { name: 'refund', description: 'Issue', tags: [] },
        score: 0.95,
        availableTools: [],
        missingTools: [],
        source: 'local' as const,
      },
    ]);

    const result = await tool.execute({ queries: ['refund'] });
    expect(result.knowledge.map((k) => k.name)).toEqual(['refund-policy']);
  });

  it('deduplicates a knowledge skill matched by multiple queries', async () => {
    mockRegistry.getKnowledgeOnlySkills.mockReturnValue([entry('refund-policy', true)]);
    mockRegistry.search
      .mockResolvedValueOnce([
        { metadata: knowledgeMeta(), score: 0.6, availableTools: [], missingTools: [], source: 'local' as const },
      ])
      .mockResolvedValueOnce([
        { metadata: knowledgeMeta(), score: 0.8, availableTools: [], missingTools: [], source: 'local' as const },
      ]);

    const result = await tool.execute({ queries: ['refund', 'eligibility'] });
    expect(result.knowledge).toHaveLength(1);
    expect(result.knowledge[0].relevanceScore).toBe(0.8);
    expect(result.knowledge[0].matchedQueries).toEqual(['refund', 'eligibility']);
  });

  it('warns when no knowledge skills match', async () => {
    mockRegistry.getKnowledgeOnlySkills.mockReturnValue([]);
    mockRegistry.search.mockResolvedValueOnce([]);

    const result = await tool.execute({ queries: ['unknown'] });
    expect(result.knowledge).toEqual([]);
    expect(result.warnings.some((w) => w.type === 'no_results')).toBe(true);
  });

  it('warns about excluded skills that do not exist', async () => {
    mockRegistry.getKnowledgeOnlySkills.mockReturnValue([entry('refund-policy', true)]);
    mockRegistry.search.mockResolvedValueOnce([
      { metadata: knowledgeMeta(), score: 0.7, availableTools: [], missingTools: [], source: 'local' as const },
    ]);

    const result = await tool.execute({ queries: ['refund'], excludeSkillNames: ['ghost'] });
    const warn = result.warnings.find((w) => w.type === 'excluded_skill_not_found');
    expect(warn?.affectedSkills).toEqual(['ghost']);
  });

  it('warns when results were filtered by minRelevanceScore', async () => {
    mockRegistry.getKnowledgeOnlySkills.mockReturnValue([entry('refund-policy', true), entry('vague', true)]);
    mockRegistry.search.mockResolvedValueOnce([
      { metadata: knowledgeMeta(), score: 0.7, availableTools: [], missingTools: [], source: 'local' as const },
      {
        metadata: { name: 'vague', description: 'low signal', tags: [] },
        score: 0.05,
        availableTools: [],
        missingTools: [],
        source: 'local' as const,
      },
    ]);

    const result = await tool.execute({ queries: ['refund'], minRelevanceScore: 0.1 });
    expect(result.knowledge.map((k) => k.name)).toEqual(['refund-policy']);
    expect(result.warnings.some((w) => w.type === 'low_relevance')).toBe(true);
  });

  it('honours excludeSkillNames for known skills', async () => {
    mockRegistry.getKnowledgeOnlySkills.mockReturnValue([entry('refund-policy', true)]);
    mockRegistry.search.mockResolvedValueOnce([
      { metadata: knowledgeMeta(), score: 0.8, availableTools: [], missingTools: [], source: 'local' as const },
    ]);

    const result = await tool.execute({ queries: ['refund'], excludeSkillNames: ['refund-policy'] });
    expect(result.knowledge).toEqual([]);
  });

  it('dispatches every query concurrently (Promise.all, not sequential await)', async () => {
    // Regression mirror of the search-skills tool — verify all queries are
    // in flight before any of them resolve.
    const inflight: Array<() => void> = [];
    mockRegistry.getKnowledgeOnlySkills.mockReturnValue([entry('refund-policy', true)]);
    mockRegistry.search.mockImplementation(
      () =>
        new Promise((resolve) => {
          inflight.push(() => resolve([]));
        }),
    );

    const promise = tool.execute({ queries: ['a', 'b', 'c'] });
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(inflight).toHaveLength(3);

    inflight.forEach((resolve) => resolve());
    await promise;
  });
});
