import { extractSchemas } from '../cli-runtime/schema-extractor';

// We need to mock require() calls inside extractSchemas.
// The function calls:
//   1. require(bundlePath) — to load the server bundle
//   2. require('@frontmcp/sdk') — to get connect()

const mockClose = jest.fn().mockResolvedValue(undefined);
const mockListTools = jest.fn();
const mockListResources = jest.fn();
const mockListResourceTemplates = jest.fn();
const mockListPrompts = jest.fn();

const mockClient = {
  listTools: mockListTools,
  listResources: mockListResources,
  listResourceTemplates: mockListResourceTemplates,
  listPrompts: mockListPrompts,
  close: mockClose,
};

const mockConnect = jest.fn().mockResolvedValue(mockClient);

jest.mock('@frontmcp/sdk', () => ({
  connect: mockConnect,
}), { virtual: true });

// Mock the bundle path to return a fake module
jest.mock('/fake/bundle.js', () => ({
  default: class FakeServer {},
}), { virtual: true });

jest.mock('/fake/no-default.js', () => ({
  config: { name: 'test' },
}), { virtual: true });

beforeEach(() => {
  jest.clearAllMocks();
  mockConnect.mockResolvedValue(mockClient);
  mockListTools.mockResolvedValue({ tools: [] });
  mockListResources.mockResolvedValue({ resources: [] });
  mockListResourceTemplates.mockResolvedValue({ resourceTemplates: [] });
  mockListPrompts.mockResolvedValue({ prompts: [] });
  mockClose.mockResolvedValue(undefined);
});

describe('extractSchemas', () => {
  it('should extract tools with name, description, and inputSchema', async () => {
    mockListTools.mockResolvedValue({
      tools: [
        {
          name: 'search_users',
          description: 'Search for users',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
        {
          name: 'add',
          description: 'Add numbers',
          inputSchema: {
            type: 'object',
            properties: { a: { type: 'number' }, b: { type: 'number' } },
          },
        },
      ],
    });

    const schema = await extractSchemas('/fake/bundle.js');

    expect(schema.tools).toHaveLength(2);
    expect(schema.tools[0]).toEqual({
      name: 'search_users',
      description: 'Search for users',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    });
    expect(schema.tools[1].name).toBe('add');
  });

  it('should extract resources with uri, name, description, and mimeType', async () => {
    mockListResources.mockResolvedValue({
      resources: [
        { uri: 'file://config.json', name: 'Config', description: 'App config', mimeType: 'application/json' },
        { uri: 'file://data.csv' },
      ],
    });

    const schema = await extractSchemas('/fake/bundle.js');

    expect(schema.resources).toHaveLength(2);
    expect(schema.resources[0]).toEqual({
      uri: 'file://config.json',
      name: 'Config',
      description: 'App config',
      mimeType: 'application/json',
    });
    // Falls back to uri as name when name not provided
    expect(schema.resources[1].name).toBe('file://data.csv');
  });

  it('should extract resource templates with uriTemplate, name, and description', async () => {
    mockListResourceTemplates.mockResolvedValue({
      resourceTemplates: [
        { uriTemplate: 'file://users/{id}', name: 'User', description: 'User resource' },
        { uriTemplate: 'file://items/{itemId}' },
      ],
    });

    const schema = await extractSchemas('/fake/bundle.js');

    expect(schema.resourceTemplates).toHaveLength(2);
    expect(schema.resourceTemplates[0]).toEqual({
      uriTemplate: 'file://users/{id}',
      name: 'User',
      description: 'User resource',
    });
    // Falls back to uriTemplate as name
    expect(schema.resourceTemplates[1].name).toBe('file://items/{itemId}');
  });

  it('should extract prompts with name, description, and arguments', async () => {
    mockListPrompts.mockResolvedValue({
      prompts: [
        {
          name: 'code_review',
          description: 'Review code',
          arguments: [
            { name: 'code', description: 'Code to review', required: true },
            { name: 'language', description: 'Programming language' },
          ],
        },
      ],
    });

    const schema = await extractSchemas('/fake/bundle.js');

    expect(schema.prompts).toHaveLength(1);
    expect(schema.prompts[0]).toEqual({
      name: 'code_review',
      description: 'Review code',
      arguments: [
        { name: 'code', description: 'Code to review', required: true },
        { name: 'language', description: 'Programming language' },
      ],
    });
  });

  it('should handle empty results (no tools, resources, prompts)', async () => {
    const schema = await extractSchemas('/fake/bundle.js');

    expect(schema.tools).toEqual([]);
    expect(schema.resources).toEqual([]);
    expect(schema.resourceTemplates).toEqual([]);
    expect(schema.prompts).toEqual([]);
  });

  it('should handle listResourceTemplates not available (older SDK)', async () => {
    const clientWithoutTemplates = {
      ...mockClient,
      listResourceTemplates: undefined,
    };
    mockConnect.mockResolvedValue(clientWithoutTemplates);

    const schema = await extractSchemas('/fake/bundle.js');

    expect(schema.resourceTemplates).toEqual([]);
  });

  it('should handle listTools rejection gracefully', async () => {
    mockListTools.mockRejectedValue(new Error('not supported'));

    const schema = await extractSchemas('/fake/bundle.js');

    // Falls back to empty via .catch()
    expect(schema.tools).toEqual([]);
    expect(schema.resources).toEqual([]);
  });

  it('should handle listResources rejection gracefully', async () => {
    mockListResources.mockRejectedValue(new Error('not supported'));

    const schema = await extractSchemas('/fake/bundle.js');

    expect(schema.resources).toEqual([]);
  });

  it('should handle listPrompts rejection gracefully', async () => {
    mockListPrompts.mockRejectedValue(new Error('not supported'));

    const schema = await extractSchemas('/fake/bundle.js');

    expect(schema.prompts).toEqual([]);
  });

  it('should handle listResourceTemplates rejection gracefully', async () => {
    mockListResourceTemplates.mockRejectedValue(new Error('not supported'));

    const schema = await extractSchemas('/fake/bundle.js');

    expect(schema.resourceTemplates).toEqual([]);
  });

  it('should call client.close() in finally block', async () => {
    await extractSchemas('/fake/bundle.js');
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('should call client.close() even when extraction fails', async () => {
    mockListTools.mockRejectedValue(new Error('fatal'));
    mockListResources.mockRejectedValue(new Error('fatal'));
    mockListPrompts.mockRejectedValue(new Error('fatal'));

    // Promise.all with .catch() on each should still succeed
    const schema = await extractSchemas('/fake/bundle.js');
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(schema.tools).toEqual([]);
  });

  it('should handle close() rejection gracefully', async () => {
    mockClose.mockRejectedValue(new Error('close failed'));

    const schema = await extractSchemas('/fake/bundle.js');

    expect(schema.tools).toEqual([]);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('should pass the config/class from bundle to connect()', async () => {
    await extractSchemas('/fake/bundle.js');

    // The mock module has { default: class FakeServer {} }
    // extractSchemas uses mod.default || mod
    expect(mockConnect).toHaveBeenCalledTimes(1);
    const arg = mockConnect.mock.calls[0][0];
    expect(typeof arg).toBe('function'); // It's the class
  });

  it('should handle bundle without default export (uses module itself)', async () => {
    await extractSchemas('/fake/no-default.js');

    expect(mockConnect).toHaveBeenCalledTimes(1);
    const arg = mockConnect.mock.calls[0][0];
    expect(arg).toEqual({ config: { name: 'test' } });
  });

  it('should provide fallback inputSchema when tool has no inputSchema', async () => {
    mockListTools.mockResolvedValue({
      tools: [{ name: 'simple' }],
    });

    const schema = await extractSchemas('/fake/bundle.js');

    expect(schema.tools[0].inputSchema).toEqual({ type: 'object', properties: {} });
  });

  it('should provide empty description when tool has no description', async () => {
    mockListTools.mockResolvedValue({
      tools: [{ name: 'nodesc', inputSchema: { type: 'object' } }],
    });

    const schema = await extractSchemas('/fake/bundle.js');

    expect(schema.tools[0].description).toBe('');
  });

  describe('capabilities detection', () => {
    it('should detect skills capability from searchSkills tool', async () => {
      mockListTools.mockResolvedValue({
        tools: [
          { name: 'searchSkills', description: 'Search skills' },
          { name: 'loadSkills', description: 'Load skills' },
          { name: 'my_tool', description: 'My tool' },
        ],
      });

      const schema = await extractSchemas('/fake/bundle.js');
      expect(schema.capabilities.skills).toBe(true);
      expect(schema.capabilities.jobs).toBe(false);
      expect(schema.capabilities.workflows).toBe(false);
    });

    it('should detect jobs capability from execute-job tool', async () => {
      mockListTools.mockResolvedValue({
        tools: [
          { name: 'execute-job', description: 'Execute job' },
          { name: 'get-job-status', description: 'Job status' },
        ],
      });

      const schema = await extractSchemas('/fake/bundle.js');
      expect(schema.capabilities.jobs).toBe(true);
      expect(schema.capabilities.skills).toBe(false);
      expect(schema.capabilities.workflows).toBe(false);
    });

    it('should detect workflows capability from execute-workflow tool', async () => {
      mockListTools.mockResolvedValue({
        tools: [
          { name: 'execute-workflow', description: 'Execute workflow' },
          { name: 'get-workflow-status', description: 'Workflow status' },
        ],
      });

      const schema = await extractSchemas('/fake/bundle.js');
      expect(schema.capabilities.workflows).toBe(true);
      expect(schema.capabilities.skills).toBe(false);
      expect(schema.capabilities.jobs).toBe(false);
    });

    it('should set all capabilities to false when no system tools present', async () => {
      mockListTools.mockResolvedValue({
        tools: [{ name: 'my_tool', description: 'My tool' }],
      });

      const schema = await extractSchemas('/fake/bundle.js');
      expect(schema.capabilities).toEqual({ skills: false, jobs: false, workflows: false });
    });

    it('should detect skills capability from loadSkills only (without searchSkills)', async () => {
      mockListTools.mockResolvedValue({
        tools: [{ name: 'loadSkills', description: 'Load skills' }],
      });

      const schema = await extractSchemas('/fake/bundle.js');
      expect(schema.capabilities.skills).toBe(true);
    });

    it('should detect jobs capability from get-job-status only (without execute-job)', async () => {
      mockListTools.mockResolvedValue({
        tools: [{ name: 'get-job-status', description: 'Job status' }],
      });

      const schema = await extractSchemas('/fake/bundle.js');
      expect(schema.capabilities.jobs).toBe(true);
    });

    it('should detect workflows capability from get-workflow-status only (without execute-workflow)', async () => {
      mockListTools.mockResolvedValue({
        tools: [{ name: 'get-workflow-status', description: 'Workflow status' }],
      });

      const schema = await extractSchemas('/fake/bundle.js');
      expect(schema.capabilities.workflows).toBe(true);
    });
  });

  describe('listTools array format', () => {
    it('should handle listTools returning array directly (not {tools:[]})', async () => {
      mockListTools.mockResolvedValue([
        { name: 'direct_tool', description: 'Direct' },
      ]);

      const schema = await extractSchemas('/fake/bundle.js');

      expect(schema.tools).toHaveLength(1);
      expect(schema.tools[0].name).toBe('direct_tool');
      expect(schema.tools[0].description).toBe('Direct');
    });

    it('should handle listTools returning object without .tools property', async () => {
      mockListTools.mockResolvedValue({ data: 'something' });

      const schema = await extractSchemas('/fake/bundle.js');

      expect(schema.tools).toEqual([]);
    });
  });

  describe('jobs extraction', () => {
    it('should extract jobs when capability is detected', async () => {
      mockListTools.mockResolvedValue({
        tools: [
          { name: 'execute-job', description: 'Execute' },
          { name: 'get-job-status', description: 'Status' },
        ],
      });

      const mockListJobs = jest.fn().mockResolvedValue({
        jobs: [
          { name: 'cleanup', description: 'Cleanup job', inputSchema: { type: 'object' }, tags: ['maintenance'] },
        ],
        count: 1,
      });
      mockConnect.mockResolvedValue({ ...mockClient, listJobs: mockListJobs });

      const schema = await extractSchemas('/fake/bundle.js');

      expect(schema.capabilities.jobs).toBe(true);
      expect(schema.jobs).toHaveLength(1);
      expect(schema.jobs[0].name).toBe('cleanup');
      expect(schema.jobs[0].tags).toEqual(['maintenance']);
    });

    it('should default to empty jobs when listJobs fails', async () => {
      mockListTools.mockResolvedValue({
        tools: [
          { name: 'execute-job', description: 'Execute' },
          { name: 'get-job-status', description: 'Status' },
        ],
      });

      const mockListJobs = jest.fn().mockRejectedValue(new Error('not available'));
      mockConnect.mockResolvedValue({ ...mockClient, listJobs: mockListJobs });

      const schema = await extractSchemas('/fake/bundle.js');

      expect(schema.capabilities.jobs).toBe(true);
      expect(schema.jobs).toEqual([]);
    });

    it('should skip jobs extraction when listJobs is not available on client', async () => {
      mockListTools.mockResolvedValue({
        tools: [
          { name: 'execute-job', description: 'Execute' },
          { name: 'get-job-status', description: 'Status' },
        ],
      });

      // Client without listJobs method
      mockConnect.mockResolvedValue({ ...mockClient });

      const schema = await extractSchemas('/fake/bundle.js');

      expect(schema.capabilities.jobs).toBe(true);
      expect(schema.jobs).toEqual([]);
    });
  });
});

describe('extractSchemas - SDK errors', () => {
  it('should throw when @frontmcp/sdk require fails', async () => {
    jest.resetModules();
    jest.doMock('@frontmcp/sdk', () => { throw new Error('Cannot find module'); }, { virtual: true });
    jest.doMock('/fake/bundle.js', () => ({ default: class {} }), { virtual: true });

    const { extractSchemas: isolatedExtract } = require('../cli-runtime/schema-extractor');

    await expect(isolatedExtract('/fake/bundle.js'))
      .rejects.toThrow('@frontmcp/sdk is required');
  });

  it('should throw when SDK has no connect()', async () => {
    jest.resetModules();
    jest.doMock('@frontmcp/sdk', () => ({ other: true }), { virtual: true });
    jest.doMock('/fake/bundle.js', () => ({ default: class {} }), { virtual: true });

    const { extractSchemas: isolatedExtract } = require('../cli-runtime/schema-extractor');

    await expect(isolatedExtract('/fake/bundle.js'))
      .rejects.toThrow('@frontmcp/sdk is required');
  });

  it('should use sdk.direct.connect when sdk.connect is not available', async () => {
    jest.resetModules();

    const mockDirectConnect = jest.fn().mockResolvedValue({
      listTools: jest.fn().mockResolvedValue({ tools: [{ name: 'tool1', description: 'Test' }] }),
      listResources: jest.fn().mockResolvedValue({ resources: [] }),
      listResourceTemplates: undefined,
      listPrompts: jest.fn().mockResolvedValue({ prompts: [] }),
      close: jest.fn().mockResolvedValue(undefined),
    });
    jest.doMock('@frontmcp/sdk', () => ({
      direct: { connect: mockDirectConnect },
    }), { virtual: true });
    jest.doMock('/fake/bundle.js', () => ({ default: class FakeServer {} }), { virtual: true });

    const { extractSchemas: isolatedExtract } = require('../cli-runtime/schema-extractor');
    const schema = await isolatedExtract('/fake/bundle.js');

    expect(mockDirectConnect).toHaveBeenCalledTimes(1);
    expect(schema.tools).toHaveLength(1);
    expect(schema.tools[0].name).toBe('tool1');
  });
});
