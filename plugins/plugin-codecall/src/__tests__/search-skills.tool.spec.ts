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

    tool = new (SearchSkillsTool as any)();
    tool.scope = { skills: mockRegistry } as never;
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
});
