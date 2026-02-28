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
});
