/**
 * Skills MCP Handlers Tests
 *
 * Tests for the skills/search, skills/load, and skills/list MCP handlers. skills/search and skills/load
 * run the real `skills:search` / `skills:load` flows on the mock scope.
 */
import { runFlowStages } from '../../../__test-utils__';
import { FrontMcpFlowTokens, type FlowMetadata, type FlowName, type FlowType } from '../../../common';
import { ProviderNotAvailableError } from '../../../errors';
import LoadSkillFlow from '../../../skill/flows/load-skill.flow';
import SearchSkillsFlow from '../../../skill/flows/search-skills.flow';
import { type McpHandlerOptions } from '../mcp-handlers.types';
import skillsListRequestHandler from '../skills-list-request.handler';
import skillsLoadRequestHandler from '../skills-load-request.handler';
import skillsSearchRequestHandler from '../skills-search-request.handler';

describe('Skills MCP Handlers', () => {
  // Mock logger
  const mockLogger = {
    child: jest.fn(() => mockLogger),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  };

  // Mock skill registry
  const mockSkillRegistry = {
    search: jest.fn(),
    loadSkill: jest.fn(),
    listSkills: jest.fn(),
    hasAny: jest.fn().mockReturnValue(true),
    findByName: jest.fn(),
    findByQualifiedName: jest.fn(),
    getSkills: jest.fn().mockReturnValue([]),
  };

  // The `skills:filter` flow, which every handler runs registered skills through
  const mockRunFlowForOutput = jest.fn();

  // Mock tool registry
  const mockToolRegistry = {
    getTools: jest.fn().mockReturnValue([]),
    getToolsForListing: jest.fn().mockReturnValue([]),
    findByName: jest.fn(),
  };

  // The flows the handlers run, with their stages in order
  const handlerFlows: Partial<Record<string, { flow: FlowType; stages: string[] }>> = {
    'skills:search': { flow: SearchSkillsFlow, stages: ['parseInput', 'search', 'finalize'] },
    'skills:load': { flow: LoadSkillFlow, stages: ['parseInput', 'loadSkills', 'activateSessions', 'finalize'] },
  };

  const flowMetadataOf = (flow: FlowType, name: string) =>
    ({
      name,
      inputSchema: Reflect.getMetadata(FrontMcpFlowTokens.inputSchema, flow),
      outputSchema: Reflect.getMetadata(FrontMcpFlowTokens.outputSchema, flow),
      plan: Reflect.getMetadata(FrontMcpFlowTokens.plan, flow),
    }) as FlowMetadata<FlowName>;

  // Create mock scope: the handlers' own flows run for real on the scope that runs them, others (`skills:filter`) are mocked
  const createMockScope = () => ({
    logger: mockLogger,
    skills: mockSkillRegistry,
    tools: mockToolRegistry,
    providers: {
      get: () => {
        throw new ProviderNotAvailableError('telemetry');
      },
    },
    async runFlowForOutput(this: object, name: string, input: unknown) {
      const handlerFlow = handlerFlows[name];
      if (!handlerFlow) return mockRunFlowForOutput(name, input);
      const FlowClass = handlerFlow.flow as unknown as new (...args: unknown[]) => unknown;
      const run = new FlowClass(flowMetadataOf(handlerFlow.flow, name), input, this, jest.fn(), new Map());
      const { output, error } = await runFlowStages(run, handlerFlow.stages);
      if (error) throw error;
      return output;
    },
  });

  // Create handler options
  const createHandlerOptions = (): McpHandlerOptions => ({
    serverOptions: {} as any,
    scope: createMockScope() as any,
  });

  // Create mock context
  const createContext = () => ({
    authInfo: {
      sessionId: 'test-session-123',
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================
  // skills/search Handler Tests
  // ============================================

  describe('skillsSearchRequestHandler', () => {
    it('should search skills with query', async () => {
      mockSkillRegistry.search.mockResolvedValueOnce([
        {
          metadata: {
            id: 'skill-1',
            name: 'Test Skill',
            description: 'A test skill',
            tags: ['test'],
            tools: [{ name: 'tool1' }],
          },
          score: 0.9,
          availableTools: ['tool1'],
          missingTools: [],
          source: 'local',
        },
      ]);

      const handler = skillsSearchRequestHandler(createHandlerOptions());
      const request = {
        method: 'skills/search' as const,
        params: { query: 'test' },
      };
      const ctx = createContext();

      const result = await handler.handler(request, ctx as any);

      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].id).toBe('skill-1');
      expect(result.skills[0].name).toBe('Test Skill');
      expect(result.skills[0].score).toBe(0.9);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
    });

    it('should pass search options to registry', async () => {
      mockSkillRegistry.search.mockResolvedValueOnce([]);

      const handler = skillsSearchRequestHandler(createHandlerOptions());
      const request = {
        method: 'skills/search' as const,
        params: {
          query: 'test',
          tags: ['tag1'],
          tools: ['tool1'],
          limit: 5,
          requireAllTools: true,
        },
      };
      const ctx = createContext();

      await handler.handler(request, ctx as any);

      expect(mockSkillRegistry.search).toHaveBeenCalledWith('test', {
        topK: 5,
        tags: ['tag1'],
        tools: ['tool1'],
        requireAllTools: true,
      });
    });

    it('should return guidance for no results', async () => {
      mockSkillRegistry.search.mockResolvedValueOnce([]);

      const handler = skillsSearchRequestHandler(createHandlerOptions());
      const request = {
        method: 'skills/search' as const,
        params: { query: 'nonexistent' },
      };
      const ctx = createContext();

      const result = await handler.handler(request, ctx as any);

      expect(result.skills).toHaveLength(0);
      expect(result.guidance).toContain('No matching skills found');
    });

    it('should throw if skills registry is not available', async () => {
      const options = createHandlerOptions();
      (options.scope as any).skills = null;

      const handler = skillsSearchRequestHandler(options);
      const request = {
        method: 'skills/search' as const,
        params: { query: 'test' },
      };
      const ctx = createContext();

      await expect(handler.handler(request, ctx as any)).rejects.toThrow(/Skills capability not available/);
    });
  });

  // ============================================
  // skills/load Handler Tests
  // ============================================

  describe('skillsLoadRequestHandler', () => {
    it('should load skills by IDs', async () => {
      mockSkillRegistry.loadSkill.mockResolvedValueOnce({
        skill: {
          id: 'skill-1',
          name: 'Test Skill',
          description: 'A test skill',
          instructions: 'Do the thing',
          tools: [{ name: 'tool1', purpose: 'For doing' }],
          parameters: [],
        },
        availableTools: ['tool1'],
        missingTools: [],
        isComplete: true,
        warning: undefined,
      });

      const handler = skillsLoadRequestHandler(createHandlerOptions());
      const request = {
        method: 'skills/load' as const,
        params: { skillIds: ['skill-1'] },
      };
      const ctx = createContext();

      const result = await handler.handler(request, ctx as any);

      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].id).toBe('skill-1');
      expect(result.skills[0].instructions).toBe('Do the thing');
      expect(result.summary.totalSkills).toBe(1);
      expect(result.summary.allToolsAvailable).toBe(true);
    });

    it('should handle missing skills with warnings', async () => {
      mockSkillRegistry.loadSkill.mockResolvedValueOnce(undefined);

      const handler = skillsLoadRequestHandler(createHandlerOptions());
      const request = {
        method: 'skills/load' as const,
        params: { skillIds: ['nonexistent'] },
      };
      const ctx = createContext();

      const result = await handler.handler(request, ctx as any);

      expect(result.skills).toHaveLength(0);
      expect(result.summary.combinedWarnings).toContain('Skill "nonexistent" not found');
    });

    it('should track missing tools across skills', async () => {
      mockSkillRegistry.loadSkill.mockResolvedValueOnce({
        skill: {
          id: 'skill-1',
          name: 'Test Skill',
          description: 'A test skill',
          instructions: 'Do the thing',
          tools: [{ name: 'tool1' }, { name: 'tool2' }],
        },
        availableTools: ['tool1'],
        missingTools: ['tool2'],
        isComplete: false,
        warning: 'Missing tool: tool2',
      });

      const handler = skillsLoadRequestHandler(createHandlerOptions());
      const request = {
        method: 'skills/load' as const,
        params: { skillIds: ['skill-1'] },
      };
      const ctx = createContext();

      const result = await handler.handler(request, ctx as any);

      expect(result.skills[0].missingTools).toContain('tool2');
      expect(result.skills[0].isComplete).toBe(false);
      expect(result.summary.allToolsAvailable).toBe(false);
      expect(result.summary.combinedWarnings).toContain('Missing tool: tool2');
    });

    it('should throw if skills registry is not available', async () => {
      const options = createHandlerOptions();
      (options.scope as any).skills = null;

      const handler = skillsLoadRequestHandler(options);
      const request = {
        method: 'skills/load' as const,
        params: { skillIds: ['skill-1'] },
      };
      const ctx = createContext();

      await expect(handler.handler(request, ctx as any)).rejects.toThrow(/Skills capability not available/);
    });

    it('should exclude tool schemas when format is instructions-only', async () => {
      // Set up tool registry with a tool that has a schema
      mockToolRegistry.getTools.mockReturnValue([
        {
          name: 'tool1',
          getInputJsonSchema: () => ({ type: 'object', properties: { foo: { type: 'string' } } }),
        },
      ]);

      mockSkillRegistry.loadSkill.mockResolvedValueOnce({
        skill: {
          id: 'skill-1',
          name: 'Test Skill',
          description: 'A test skill',
          instructions: 'Do the thing',
          tools: [{ name: 'tool1', purpose: 'For doing' }],
          parameters: [],
        },
        availableTools: ['tool1'],
        missingTools: [],
        isComplete: true,
        warning: undefined,
      });

      const handler = skillsLoadRequestHandler(createHandlerOptions());
      const request = {
        method: 'skills/load' as const,
        params: { skillIds: ['skill-1'], format: 'instructions-only' as const },
      };
      const ctx = createContext();

      const result = await handler.handler(request, ctx as any);

      expect(result.skills).toHaveLength(1);
      // When format is 'instructions-only', inputSchema should not be included
      expect(result.skills[0].tools[0].inputSchema).toBeUndefined();
    });
  });

  // ============================================
  // skills/list Handler Tests
  // ============================================

  describe('skillsListRequestHandler', () => {
    it('should list all skills', async () => {
      mockSkillRegistry.listSkills.mockResolvedValueOnce({
        skills: [
          { id: 'skill-1', name: 'Skill One', description: 'First skill', tags: ['tag1'], priority: 1 },
          { id: 'skill-2', name: 'Skill Two', description: 'Second skill', tags: ['tag2'], priority: 2 },
        ],
        total: 2,
        hasMore: false,
      });

      const handler = skillsListRequestHandler(createHandlerOptions());
      const request = {
        method: 'skills/list' as const,
        params: {},
      };
      const ctx = createContext();

      const result = await handler.handler(request, ctx as any);

      expect(result.skills).toHaveLength(2);
      expect(result.skills[0].id).toBe('skill-1');
      expect(result.skills[1].id).toBe('skill-2');
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(false);
    });

    it('should pass list options to registry', async () => {
      mockSkillRegistry.listSkills.mockResolvedValueOnce({
        skills: [],
        total: 0,
        hasMore: false,
      });

      const handler = skillsListRequestHandler(createHandlerOptions());
      const request = {
        method: 'skills/list' as const,
        params: {
          offset: 10,
          limit: 20,
          tags: ['tag1'],
          sortBy: 'priority' as const,
          sortOrder: 'desc' as const,
          includeHidden: true,
        },
      };
      const ctx = createContext();

      await handler.handler(request, ctx as any);

      // The whole matching catalog is read (then filtered and paged), so the request's own
      // offset and limit are applied after filtering, not passed to the registry.
      expect(mockSkillRegistry.listSkills).toHaveBeenCalledWith({
        offset: 0,
        limit: 100,
        tags: ['tag1'],
        sortBy: 'priority',
        sortOrder: 'desc',
        includeHidden: true,
      });
    });

    it('should handle pagination correctly', async () => {
      const catalog = Array.from({ length: 250 }, (_, i) => ({
        id: `skill-${i}`,
        name: `Skill ${i}`,
        description: 'd',
      }));
      mockSkillRegistry.listSkills.mockImplementation(async ({ offset = 0, limit = 50 }) => ({
        skills: catalog.slice(offset, offset + limit),
        total: catalog.length,
        hasMore: offset + limit < catalog.length,
      }));

      const handler = skillsListRequestHandler(createHandlerOptions());
      const ctx = createContext();
      const first = await handler.handler(
        { method: 'skills/list' as const, params: { offset: 0, limit: 10 } },
        ctx as any,
      );
      const last = await handler.handler(
        { method: 'skills/list' as const, params: { offset: 240, limit: 20 } },
        ctx as any,
      );

      expect({ ids: first.skills.map((skill) => skill.id), total: first.total, hasMore: first.hasMore }).toEqual({
        ids: catalog.slice(0, 10).map((skill) => skill.id),
        total: 250,
        hasMore: true,
      });
      expect({ count: last.skills.length, total: last.total, hasMore: last.hasMore }).toEqual({
        count: 10,
        total: 250,
        hasMore: false,
      });
      mockSkillRegistry.listSkills.mockReset();
    });

    it('reads a large catalog in two registry calls, not one per 100 skills', async () => {
      const catalog = Array.from({ length: 2500 }, (_, i) => ({
        id: `skill-${i}`,
        name: `Skill ${i}`,
        description: 'd',
      }));
      mockSkillRegistry.listSkills.mockImplementation(async ({ offset = 0, limit = 50 }) => ({
        skills: catalog.slice(offset, offset + limit),
        total: catalog.length,
        hasMore: offset + limit < catalog.length,
      }));

      const handler = skillsListRequestHandler(createHandlerOptions());
      const result = await handler.handler(
        { method: 'skills/list' as const, params: { offset: 2490, limit: 20 } },
        createContext() as any,
      );

      expect({ count: result.skills.length, total: result.total, hasMore: result.hasMore }).toEqual({
        count: 10,
        total: 2500,
        hasMore: false,
      });
      expect(mockSkillRegistry.listSkills).toHaveBeenCalledTimes(2);
      mockSkillRegistry.listSkills.mockReset();
    });

    it('still reads the whole catalog from a registry that caps its page size', async () => {
      const catalog = Array.from({ length: 250 }, (_, i) => ({
        id: `skill-${i}`,
        name: `Skill ${i}`,
        description: 'd',
      }));
      mockSkillRegistry.listSkills.mockImplementation(async ({ offset = 0, limit = 50 }) => {
        const size = Math.min(limit, 100);
        return {
          skills: catalog.slice(offset, offset + size),
          total: catalog.length,
          hasMore: offset + size < catalog.length,
        };
      });

      const handler = skillsListRequestHandler(createHandlerOptions());
      const result = await handler.handler(
        { method: 'skills/list' as const, params: { offset: 240, limit: 20 } },
        createContext() as any,
      );

      expect({ count: result.skills.length, total: result.total }).toEqual({ count: 10, total: 250 });
      expect(mockSkillRegistry.listSkills).toHaveBeenCalledTimes(3);
      mockSkillRegistry.listSkills.mockReset();
    });

    it('should handle undefined params', async () => {
      mockSkillRegistry.listSkills.mockResolvedValueOnce({
        skills: [],
        total: 0,
        hasMore: false,
      });

      const handler = skillsListRequestHandler(createHandlerOptions());
      const request = {
        method: 'skills/list' as const,
        params: undefined,
      };
      const ctx = createContext();

      const result = await handler.handler(request, ctx as any);

      expect(mockSkillRegistry.listSkills).toHaveBeenCalledWith({ offset: 0, limit: 100 });
      expect(result.skills).toHaveLength(0);
    });

    it('should throw if skills registry is not available', async () => {
      const options = createHandlerOptions();
      (options.scope as any).skills = null;

      const handler = skillsListRequestHandler(options);
      const request = {
        method: 'skills/list' as const,
        params: {},
      };
      const ctx = createContext();

      await expect(handler.handler(request, ctx as any)).rejects.toThrow(/Skills capability not available/);
    });
  });

  // ============================================
  // skills:filter flow (GHSA-gf7p-j3hr-h5h4)
  // ============================================

  describe('skills the skills:filter flow drops (GHSA-gf7p-j3hr-h5h4)', () => {
    const droppedSkill = { name: 'skill-1', metadata: { id: 'skill-1', name: 'skill-1' } };

    beforeEach(() => {
      mockSkillRegistry.findByName.mockImplementation((id: string) => (id === 'skill-1' ? droppedSkill : undefined));
      mockRunFlowForOutput.mockResolvedValue({ skills: [] });
    });

    afterEach(() => {
      mockSkillRegistry.findByName.mockReset();
      mockRunFlowForOutput.mockReset();
    });

    it('leaves them out of skills/search', async () => {
      mockSkillRegistry.search.mockResolvedValueOnce([
        {
          metadata: { id: 'skill-1', name: 'skill-1', description: 'Dropped' },
          score: 0.9,
          availableTools: [],
          missingTools: [],
          source: 'local',
        },
        {
          metadata: { id: 'external-skill', name: 'external-skill', description: 'Not registered here' },
          score: 0.5,
          availableTools: [],
          missingTools: [],
          source: 'external',
        },
      ]);

      const handler = skillsSearchRequestHandler(createHandlerOptions());
      const ctx = createContext();
      const result = await handler.handler(
        { method: 'skills/search' as const, params: { query: 'skill' } },
        ctx as any,
      );

      // The handler passes its context on tagged with the request's surface.
      expect(mockRunFlowForOutput).toHaveBeenCalledWith('skills:filter', {
        skills: [droppedSkill],
        ctx: { ...ctx, surface: 'mcp' },
      });
      expect(result.skills.map((skill) => skill.id)).toEqual(['external-skill']);
    });

    it('leaves them out of skills/list and its total', async () => {
      mockSkillRegistry.listSkills.mockResolvedValueOnce({
        skills: [{ id: 'skill-1', name: 'skill-1', description: 'Dropped' }],
        total: 1,
        hasMore: false,
      });

      const handler = skillsListRequestHandler(createHandlerOptions());
      const result = await handler.handler({ method: 'skills/list' as const, params: {} }, createContext() as any);

      expect(result.skills).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('pages skills/list after leaving them out, so they take no page slots and are not counted', async () => {
      const catalog = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, name: id, description: id }));
      const hidden = new Set(['a', 'd']);
      mockSkillRegistry.listSkills.mockImplementation(async ({ offset = 0, limit = 50 }) => ({
        skills: catalog.slice(offset, offset + limit),
        total: catalog.length,
        hasMore: offset + limit < catalog.length,
      }));
      mockSkillRegistry.findByName.mockImplementation((id: string) => ({ name: id, metadata: { id, name: id } }));
      mockRunFlowForOutput.mockImplementation(async (_flow: string, input: { skills: Array<{ name: string }> }) => ({
        skills: input.skills.filter((skill) => !hidden.has(skill.name)),
      }));

      const handler = skillsListRequestHandler(createHandlerOptions());
      const page = async (offset: number) => {
        const result = await handler.handler(
          { method: 'skills/list' as const, params: { offset, limit: 2 } },
          createContext() as any,
        );
        return { ids: result.skills.map((skill) => skill.id), total: result.total, hasMore: result.hasMore };
      };

      expect([await page(0), await page(2)]).toEqual([
        { ids: ['b', 'c'], total: 3, hasMore: true },
        { ids: ['e'], total: 3, hasMore: false },
      ]);
      mockSkillRegistry.listSkills.mockReset();
    });

    it('reports them as not found from skills/load', async () => {
      mockSkillRegistry.loadSkill.mockResolvedValueOnce({
        skill: { id: 'skill-1', name: 'skill-1', description: 'Dropped', instructions: 'Secret steps', tools: [] },
        availableTools: [],
        missingTools: [],
        isComplete: true,
      });

      const handler = skillsLoadRequestHandler(createHandlerOptions());
      const result = await handler.handler(
        { method: 'skills/load' as const, params: { skillIds: ['skill-1'] } },
        createContext() as any,
      );

      expect(result.skills).toEqual([]);
      expect(result.summary.combinedWarnings).toEqual(['Skill "skill-1" not found']);
    });
  });

  describe('resolving each result to its entry once, for every gate (#599)', () => {
    const authoritiesEngine = { evaluate: jest.fn() };
    const authoritiesContextBuilder = { build: jest.fn(() => ({})) };

    const createGatedHandlerOptions = (): McpHandlerOptions => ({
      serverOptions: {} as any,
      scope: { ...createMockScope(), authoritiesEngine, authoritiesContextBuilder } as any,
    });

    const searchResult = (id: string) => ({
      metadata: { id, name: id, description: id },
      score: 0.9,
      availableTools: [],
      missingTools: [],
      source: 'external',
    });

    beforeEach(() => {
      authoritiesEngine.evaluate.mockResolvedValue({ granted: true });
      mockRunFlowForOutput.mockImplementation(async (_flow: string, input: { skills: unknown[] }) => ({
        skills: input.skills,
      }));
    });

    afterEach(() => {
      mockSkillRegistry.findByName.mockReset();
      mockRunFlowForOutput.mockReset();
      authoritiesEngine.evaluate.mockReset();
    });

    it('gives skills:filter the same entry the authorities gate judged, even if the skill is swapped in between', async () => {
      const judged = { name: 'report', metadata: { id: 'report', name: 'report', authorities: { roles: ['admin'] } } };
      const swappedIn = { name: 'report', metadata: { id: 'report', name: 'report', featureFlag: 'reports' } };
      mockSkillRegistry.findByName.mockReturnValueOnce(judged).mockReturnValue(swappedIn);
      mockSkillRegistry.search.mockResolvedValueOnce([searchResult('report')]);

      const ctx = createContext();
      await skillsSearchRequestHandler(createGatedHandlerOptions()).handler(
        { method: 'skills/search' as const, params: { query: 'report' } },
        ctx as any,
      );

      expect(authoritiesEngine.evaluate).toHaveBeenCalledWith(judged.metadata.authorities, {});
      expect(mockRunFlowForOutput).toHaveBeenCalledWith('skills:filter', {
        skills: [judged],
        ctx: { ...ctx, surface: 'mcp' },
      });
    });

    it('does not list the registry again for every result it cannot resolve', async () => {
      mockSkillRegistry.search.mockResolvedValueOnce([searchResult('a'), searchResult('b'), searchResult('c')]);

      const result = await skillsSearchRequestHandler(createGatedHandlerOptions()).handler(
        { method: 'skills/search' as const, params: { query: 'external' } },
        createContext() as any,
      );

      expect(result.skills.map((skill) => skill.id)).toEqual(['a', 'b', 'c']);
      expect(mockSkillRegistry.getSkills).toHaveBeenCalledTimes(1);
    });
  });
});
