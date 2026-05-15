/**
 * Tests for `createMcpHandlers` registration matrix (issue #407).
 *
 * Before the fix:
 *   - `tools/list`, `resources/list`, `resources/templates/list`, `prompts/list`
 *     handlers were only registered when the corresponding capability flag was
 *     truthy in `serverOptions.capabilities.*`. Capability flags themselves are
 *     gated on `registry.hasAny()` — so empty registries produced zero list
 *     handlers and clients calling `mcp.tools.list()` etc. received JSON-RPC
 *     -32601 "Method not found".
 *
 * After the fix:
 *   - The four list handlers are always registered.
 *   - `tools/call`, `resources/read`, `resources/subscribe`, `resources/unsubscribe`,
 *     `prompts/get` remain gated on capability (a client should not invoke them
 *     against a server that didn't advertise the capability anyway).
 */

import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@frontmcp/protocol';

import { createMcpHandlers } from '../index';
import { type McpHandlerOptions } from '../mcp-handlers.types';

const mockLogger = {
  child: () => mockLogger,
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
};

const makeOptions = (capabilities: Record<string, unknown> = {}): McpHandlerOptions => ({
  serverOptions: { capabilities } as never,
  scope: {
    logger: mockLogger,
    skills: { hasAny: () => false },
  } as never,
});

describe('createMcpHandlers (issue #407)', () => {
  describe('list handlers are unconditionally registered', () => {
    it('registers tools/list even when capabilities.tools is absent', () => {
      const schemas = createMcpHandlers(makeOptions()).map((h) => h.requestSchema);
      expect(schemas).toContain(ListToolsRequestSchema);
    });

    it('registers resources/list and resources/templates/list even when capabilities.resources is absent', () => {
      const schemas = createMcpHandlers(makeOptions()).map((h) => h.requestSchema);
      expect(schemas).toContain(ListResourcesRequestSchema);
      expect(schemas).toContain(ListResourceTemplatesRequestSchema);
    });

    it('registers prompts/list even when capabilities.prompts is absent', () => {
      const schemas = createMcpHandlers(makeOptions()).map((h) => h.requestSchema);
      expect(schemas).toContain(ListPromptsRequestSchema);
    });

    it('registers all four list handlers when no capabilities are advertised at all', () => {
      const schemas = createMcpHandlers(makeOptions({})).map((h) => h.requestSchema);
      expect(schemas).toContain(ListToolsRequestSchema);
      expect(schemas).toContain(ListResourcesRequestSchema);
      expect(schemas).toContain(ListResourceTemplatesRequestSchema);
      expect(schemas).toContain(ListPromptsRequestSchema);
    });
  });

  describe('call / read / get / subscribe / unsubscribe remain capability-gated', () => {
    it('does NOT register tools/call when capabilities.tools is absent', () => {
      const schemas = createMcpHandlers(makeOptions()).map((h) => h.requestSchema);
      expect(schemas).not.toContain(CallToolRequestSchema);
    });

    it('does NOT register resources/read / subscribe / unsubscribe when capabilities.resources is absent', () => {
      const schemas = createMcpHandlers(makeOptions()).map((h) => h.requestSchema);
      expect(schemas).not.toContain(ReadResourceRequestSchema);
      expect(schemas).not.toContain(SubscribeRequestSchema);
      expect(schemas).not.toContain(UnsubscribeRequestSchema);
    });

    it('does NOT register prompts/get when capabilities.prompts is absent', () => {
      const schemas = createMcpHandlers(makeOptions()).map((h) => h.requestSchema);
      expect(schemas).not.toContain(GetPromptRequestSchema);
    });

    it('registers tools/call when capabilities.tools is advertised', () => {
      const schemas = createMcpHandlers(makeOptions({ tools: { listChanged: true } })).map((h) => h.requestSchema);
      expect(schemas).toContain(CallToolRequestSchema);
      // list handlers still present (they're now always-on)
      expect(schemas).toContain(ListToolsRequestSchema);
    });

    it('registers resources/read + subscribe + unsubscribe when capabilities.resources is advertised', () => {
      const schemas = createMcpHandlers(makeOptions({ resources: { listChanged: true, subscribe: true } })).map(
        (h) => h.requestSchema,
      );
      expect(schemas).toContain(ReadResourceRequestSchema);
      expect(schemas).toContain(SubscribeRequestSchema);
      expect(schemas).toContain(UnsubscribeRequestSchema);
    });

    it('registers prompts/get when capabilities.prompts is advertised', () => {
      const schemas = createMcpHandlers(makeOptions({ prompts: { listChanged: true } })).map((h) => h.requestSchema);
      expect(schemas).toContain(GetPromptRequestSchema);
    });
  });
});

/**
 * End-to-end regression: boot a real `DirectMcpServer` with zero tools,
 * resources, prompts and verify the list methods return empty arrays
 * (not JSON-RPC -32601 "Method not found"). This catches breakage if the
 * handler-registration matrix is ever silently coupled back to capability
 * advertisement.
 */
describe('Empty-server list methods end-to-end (issue #407)', () => {
  // Resetting modules ensures a clean instance cache across test files; aligns
  // with the pattern used in direct/__tests__/create.spec.ts.
  beforeEach(() => {
    jest.resetModules();
  });

  it('mcp.tools.list() on a server with zero tools returns { tools: [] }', async () => {
    const { create } = await import('../../../direct/create');
    const server = await create({
      info: { name: 'fix-407-empty-tools', version: '0.0.0' },
    });
    // try/finally so `dispose()` runs even when an expectation throws —
    // leaving the in-memory server open creates flakiness in adjacent
    // tests (CodeRabbit on PR #423).
    try {
      const result = await server.listTools();
      expect(result).toMatchObject({ tools: [] });
    } finally {
      await server.dispose();
    }
  });

  it('mcp.resources.list() on a server with zero resources returns { resources: [] }', async () => {
    const { create } = await import('../../../direct/create');
    const server = await create({
      info: { name: 'fix-407-empty-resources', version: '0.0.0' },
    });
    try {
      const result = await server.listResources();
      expect(result).toMatchObject({ resources: [] });
    } finally {
      await server.dispose();
    }
  });

  it('mcp.prompts.list() on a server with zero prompts returns { prompts: [] }', async () => {
    const { create } = await import('../../../direct/create');
    const server = await create({
      info: { name: 'fix-407-empty-prompts', version: '0.0.0' },
    });
    try {
      const result = await server.listPrompts();
      expect(result).toMatchObject({ prompts: [] });
    } finally {
      await server.dispose();
    }
  });
});
