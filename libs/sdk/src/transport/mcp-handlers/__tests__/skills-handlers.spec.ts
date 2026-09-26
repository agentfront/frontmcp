/**
 * Skills MCP Handlers Tests
 *
 * Tests for the skills/search, skills/load, and skills/list MCP handlers.
 */
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

  // Create mock scope
  const createMockScope = () => ({
    logger: mockLogger,
    skills: mockSkillRegistry,
    tools: mockToolRegistry,
    runFlowForOutput: mockRunFlowForOutput,
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

      expect(mockSkillRegistry.listSkills).toHaveBeenCalledWith({
        offset: 10,
        limit: 20,
        tags: ['tag1'],
        sortBy: 'priority',
        sortOrder: 'desc',
        includeHidden: true,
      });
    });

    it('should handle pagination correctly', async () => {
      mockSkillRegistry.listSkills.mockResolvedValueOnce({
        skills: [{ id: 'skill-1', name: 'Skill', description: 'desc' }],
        total: 100,
        hasMore: true,
      });

      const handler = skillsListRequestHandler(createHandlerOptions());
      const request = {
        method: 'skills/list' as const,
        params: { offset: 0, limit: 10 },
      };
      const ctx = createContext();

      const result = await handler.handler(request, ctx as any);

      expect(result.total).toBe(100);
      expect(result.hasMore).toBe(true);
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

      expect(mockSkillRegistry.listSkills).toHaveBeenCalledWith({});
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
      const result = await handler.handler(
        { method: 'skills/search' as const, params: { query: 'skill' } },
        createContext() as any,
      );

      expect(mockRunFlowForOutput).toHaveBeenCalledWith('skills:filter', { skills: [droppedSkill] });
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
});
