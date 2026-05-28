// file: libs/plugins/src/codecall/__tests__/search-skills.tool.spec.ts

import type { SearchSkillsToolOutput } from '../tools/search-skills.schema';
import SearchSkillsTool from '../tools/search-skills.tool';

// Mock the SDK — mirrors the pattern in search.tool.spec.ts.
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

    setService(token: unknown, service: unknown) {
      this.services.set(token, service);
    }
  },
}));

interface MockSkillEntry {
  name: string;
  isExecutable: () => boolean;
  isKnowledgeOnly: () => boolean;
}

interface MockSearchResult {
  metadata: {
    name: string;
    description: string;
    tags?: string[];
    tools?: Array<string | { name: string }>;
    referencedOperations?: Array<{ spec: string; operationId: string }>;
  };
  score: number;
  availableTools: string[];
  missingTools: string[];
  source: 'local' | 'external';
}

function entry(name: string, executable: boolean): MockSkillEntry {
  return {
    name,
    isExecutable: () => executable,
    isKnowledgeOnly: () => !executable,
  };
}

function describeExecutable(): MockSearchResult['metadata'] {
  return {
    name: 'refund',
    description: 'Issue a refund',
    tags: ['billing'],
    referencedOperations: [
      { spec: 'acme', operationId: 'getOrder' },
      { spec: 'acme', operationId: 'issueRefund' },
    ],
  };
}

describe('SearchSkillsTool', () => {
  let tool: SearchSkillsTool & {
    setService: (token: unknown, service: unknown) => void;
    scope: { skills: { getExecutableSkills: jest.Mock; search: jest.Mock } };
  };
  let mockRegistry: { getExecutableSkills: jest.Mock; search: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();

    mockRegistry = {
      getExecutableSkills: jest.fn(),
      search: jest.fn(),
    };

    // Mirror search-knowledge.tool.spec.ts: the mocked ToolContext takes
    // no required args, so we can cast to a parameterless constructor and
    // avoid `any`. `scope` is injected matching the typed local.
    type SearchSkillsToolCtor = new () => SearchSkillsTool;
    tool = new (SearchSkillsTool as unknown as SearchSkillsToolCtor)() as typeof tool;
    tool.scope = { skills: mockRegistry };
  });

  describe('happy path', () => {
    it('returns ranked executable skills with inlined operations', async () => {
      mockRegistry.getExecutableSkills.mockReturnValue([entry('refund', true), entry('audit', true)]);
      mockRegistry.search.mockResolvedValueOnce([
        {
          metadata: describeExecutable(),
          score: 0.85,
          availableTools: [],
          missingTools: [],
          source: 'local' as const,
        },
      ]);

      const result: SearchSkillsToolOutput = await tool.execute({
        queries: ['refund an order'],
        topK: 5,
        minRelevanceScore: 0.1,
      });

      expect(result.skills).toHaveLength(1);
      expect(result.skills[0]).toMatchObject({
        name: 'refund',
        description: 'Issue a refund',
        tags: ['billing'],
        operations: [
          { spec: 'acme', operationId: 'getOrder' },
          { spec: 'acme', operationId: 'issueRefund' },
        ],
        relevanceScore: 0.85,
        matchedQueries: ['refund an order'],
        source: 'local',
      });
      expect(result.totalExecutableSkills).toBe(2);
    });

    it('deduplicates skills matched by multiple queries; highest score wins', async () => {
      mockRegistry.getExecutableSkills.mockReturnValue([entry('refund', true)]);
      mockRegistry.search
        .mockResolvedValueOnce([
          { metadata: describeExecutable(), score: 0.7, availableTools: [], missingTools: [], source: 'local' },
        ])
        .mockResolvedValueOnce([
          { metadata: describeExecutable(), score: 0.9, availableTools: [], missingTools: [], source: 'local' },
        ]);

      const result = await tool.execute({ queries: ['refund', 'cancel'] });

      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].relevanceScore).toBe(0.9);
      expect(result.skills[0].matchedQueries).toEqual(['refund', 'cancel']);
    });

    it('filters out knowledge-only skills returned by the registry search', async () => {
      mockRegistry.getExecutableSkills.mockReturnValue([entry('refund', true)]);
      mockRegistry.search.mockResolvedValueOnce([
        {
          metadata: { name: 'refund-policy', description: 'Policy', tags: [] },
          score: 0.95,
          availableTools: [],
          missingTools: [],
          source: 'local',
        },
        {
          metadata: describeExecutable(),
          score: 0.6,
          availableTools: [],
          missingTools: [],
          source: 'local',
        },
      ]);

      const result = await tool.execute({ queries: ['refund'] });

      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe('refund');
    });

    it('captures decorator-declared tools from the result metadata', async () => {
      mockRegistry.getExecutableSkills.mockReturnValue([entry('with-tools', true)]);
      mockRegistry.search.mockResolvedValueOnce([
        {
          metadata: {
            name: 'with-tools',
            description: 'Has tool refs',
            tags: [],
            tools: ['some_tool', { name: 'another_tool' }],
          },
          score: 0.8,
          availableTools: ['some_tool'],
          missingTools: ['another_tool'],
          source: 'local',
        },
      ]);

      const result = await tool.execute({ queries: ['anything'] });
      expect(result.skills[0].tools).toEqual(['some_tool', 'another_tool']);
      expect(result.skills[0].operations).toEqual([]);
    });
  });

  describe('warnings', () => {
    it('warns when no executable skills match', async () => {
      mockRegistry.getExecutableSkills.mockReturnValue([]);
      mockRegistry.search.mockResolvedValueOnce([]);

      const result = await tool.execute({ queries: ['nothing'] });
      expect(result.skills).toEqual([]);
      expect(result.warnings.some((w) => w.type === 'no_results')).toBe(true);
    });

    it('warns when excludeSkillNames contains a name that does not exist', async () => {
      mockRegistry.getExecutableSkills.mockReturnValue([entry('refund', true)]);
      mockRegistry.search.mockResolvedValueOnce([
        { metadata: describeExecutable(), score: 0.8, availableTools: [], missingTools: [], source: 'local' },
      ]);

      const result = await tool.execute({ queries: ['refund'], excludeSkillNames: ['unknown-skill'] });

      const warn = result.warnings.find((w) => w.type === 'excluded_skill_not_found');
      expect(warn).toBeDefined();
      expect(warn?.affectedSkills).toEqual(['unknown-skill']);
    });

    it('warns when results were filtered out by minRelevanceScore', async () => {
      mockRegistry.getExecutableSkills.mockReturnValue([entry('refund', true), entry('other', true)]);
      mockRegistry.search.mockResolvedValueOnce([
        { metadata: describeExecutable(), score: 0.8, availableTools: [], missingTools: [], source: 'local' },
        {
          metadata: { ...describeExecutable(), name: 'other' },
          score: 0.05,
          availableTools: [],
          missingTools: [],
          source: 'local',
        },
      ]);

      const result = await tool.execute({ queries: ['refund'], minRelevanceScore: 0.1 });
      expect(result.skills.map((s) => s.name)).toEqual(['refund']);
      expect(result.warnings.some((w) => w.type === 'low_relevance')).toBe(true);
    });

    it('honours the excludeSkillNames filter for known skills', async () => {
      mockRegistry.getExecutableSkills.mockReturnValue([entry('refund', true)]);
      mockRegistry.search.mockResolvedValueOnce([
        { metadata: describeExecutable(), score: 0.9, availableTools: [], missingTools: [], source: 'local' },
      ]);

      const result = await tool.execute({ queries: ['refund'], excludeSkillNames: ['refund'] });
      expect(result.skills).toEqual([]);
    });
  });

  describe('parallelism', () => {
    it('dispatches every query concurrently (Promise.all, not sequential await)', async () => {
      // Regression: this previously awaited each query in a for-loop, multiplying
      // search latency by `queries.length`. If the impl regresses to serial
      // awaits, the elapsed time would exceed the sum-of-individual-delays;
      // here we instead verify that all calls have been issued BEFORE any of
      // their responses are resolved.
      const inflight: Array<() => void> = [];
      mockRegistry.getExecutableSkills.mockReturnValue([entry('refund', true)]);
      mockRegistry.search.mockImplementation(
        () =>
          new Promise((resolve) => {
            inflight.push(() => resolve([]));
          }),
      );

      const promise = tool.execute({ queries: ['a', 'b', 'c'] });

      // Yield a few microtask turns so the synchronous Promise.all kicks off.
      for (let i = 0; i < 5; i++) await Promise.resolve();

      // All three search() calls must have been issued already; this only
      // holds if the impl ran them in parallel.
      expect(inflight).toHaveLength(3);

      // Resolve them and let execute() finish.
      inflight.forEach((resolve) => resolve());
      await promise;
    });
  });

  describe('hidden executable skills', () => {
    it('hidden skills are silently excluded — getExecutableSkills filters hideFromDiscovery=true', async () => {
      // The tool consults getExecutableSkills() WITHOUT includeHidden, so
      // any skill that's executable AND hidden is dropped from the search
      // results even if the underlying registry.search() returns it. The
      // executableSet double-check at the result-loop is what enforces this.
      mockRegistry.getExecutableSkills.mockReturnValue([entry('refund', true)]); // 'hidden' NOT in this list
      mockRegistry.search.mockResolvedValueOnce([
        {
          metadata: { name: 'hidden', description: 'an executable hidden skill', tags: [] },
          score: 0.99,
          availableTools: [],
          missingTools: [],
          source: 'local',
        },
        { metadata: describeExecutable(), score: 0.6, availableTools: [], missingTools: [], source: 'local' },
      ]);

      const result = await tool.execute({ queries: ['anything'] });

      expect(result.skills.map((s) => s.name)).toEqual(['refund']);
    });
  });
});
