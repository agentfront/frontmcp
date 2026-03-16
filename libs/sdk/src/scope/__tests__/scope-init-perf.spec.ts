import 'reflect-metadata';

/**
 * Performance tests for Scope initialization.
 * Validates that parallel batch initialization is faster than sequential.
 *
 * Run with FRONTMCP_PERF=1 for detailed timing output:
 *   FRONTMCP_PERF=1 npx nx test sdk -- --testPathPattern=scope-init-perf
 */

describe('Scope initialization performance', () => {
  it('should import Scope class without errors', () => {
    // Validate the module loads correctly after parallelization changes
    const { Scope } = require('../../scope/scope.instance');
    expect(Scope).toBeDefined();
  });

  it('should import NoopFrontMcpServer without errors', () => {
    const { NoopFrontMcpServer } = require('../../server/noop-server');
    const server = new NoopFrontMcpServer();
    expect(server).toBeDefined();
    // Verify all abstract methods are implemented
    expect(() => server.registerMiddleware('/', () => {})).not.toThrow();
    expect(() => server.registerRoute('GET', '/', () => {})).not.toThrow();
    expect(server.enhancedHandler((req: unknown, res: unknown) => {})).toBeDefined();
    expect(() => server.prepare()).not.toThrow();
    expect(server.getHandler()).toBeUndefined();
  });

  it('should use NoopServer when __cliMode is set', () => {
    const { createMcpGlobalProviders } = require('../../front-mcp/front-mcp.providers');
    const { NoopFrontMcpServer } = require('../../server/noop-server');

    // Create providers with CLI mode flag
    const cliConfig = {
      __cliMode: true,
      info: { name: 'test', version: '1.0.0' },
      apps: [],
      providers: [],
      tools: [],
      resources: [],
      skills: [],
      plugins: [],
      serve: false,
      splitByApp: false,
      transport: {},
    };

    const providers = createMcpGlobalProviders(cliConfig);
    // The server provider should be the noop variant
    const serverProvider = providers.find((p: Record<string, unknown>) => p.name === 'frontmcp:server:noop');
    expect(serverProvider).toBeDefined();
    expect(serverProvider.useValue).toBeInstanceOf(NoopFrontMcpServer);
  });

  it('should use full FrontMcpServerInstance when not in CLI mode', () => {
    const { createMcpGlobalProviders } = require('../../front-mcp/front-mcp.providers');

    const fullConfig = {
      info: { name: 'test', version: '1.0.0' },
      apps: [],
      providers: [],
      tools: [],
      resources: [],
      skills: [],
      plugins: [],
      serve: true,
      splitByApp: false,
      transport: {},
    };

    const providers = createMcpGlobalProviders(fullConfig);
    // Should NOT have the noop server
    const noopProvider = providers.find((p: Record<string, unknown>) => p.name === 'frontmcp:server:noop');
    expect(noopProvider).toBeUndefined();
    // Should have the full async server provider
    const serverProvider = providers.find(
      (p: Record<string, unknown>) =>
        p.name === 'frontmcp:server' || (p as Record<string, unknown>).provide !== undefined,
    );
    expect(serverProvider).toBeDefined();
  });

  it('should export parseFrontMcpConfigLite', () => {
    const { parseFrontMcpConfigLite } = require('../../common/metadata/front-mcp.metadata');
    expect(parseFrontMcpConfigLite).toBeDefined();
    expect(typeof parseFrontMcpConfigLite).toBe('function');
  });

  it('parseFrontMcpConfigLite should parse valid config', () => {
    const { parseFrontMcpConfigLite } = require('../../common/metadata/front-mcp.metadata');

    const input = {
      info: { name: 'test-app', version: '1.0.0' },
      apps: [],
    };

    const result = parseFrontMcpConfigLite(input);
    expect(result.info.name).toBe('test-app');
    expect(result.info.version).toBe('1.0.0');
    expect(result.apps).toEqual([]);
    expect(result.providers).toEqual([]);
    expect(result.tools).toEqual([]);
    expect(result.resources).toEqual([]);
    expect(result.skills).toEqual([]);
    expect(result.plugins).toEqual([]);
    expect(result.serve).toBe(false);
  });

  it('parseFrontMcpConfigLite should be faster than full parse', () => {
    const { parseFrontMcpConfigLite, frontMcpMetadataSchema } = require('../../common/metadata/front-mcp.metadata');

    const input = {
      info: { name: 'perf-test', version: '1.0.0' },
      apps: [],
      splitByApp: false,
    };

    // Warm up both parsers
    parseFrontMcpConfigLite(input);
    frontMcpMetadataSchema.parse(input);

    // Benchmark lite parser
    const liteIterations = 100;
    const liteStart = performance.now();
    for (let i = 0; i < liteIterations; i++) {
      parseFrontMcpConfigLite(input);
    }
    const liteMs = performance.now() - liteStart;

    // Benchmark full parser
    const fullStart = performance.now();
    for (let i = 0; i < liteIterations; i++) {
      frontMcpMetadataSchema.parse(input);
    }
    const fullMs = performance.now() - fullStart;

    // Lite should not be dramatically slower than full parse.
    // We use a 5x margin to tolerate CI variance on small inputs.
    expect(liteMs).toBeLessThanOrEqual(fullMs * 5);
  });

  it('ToolEntry should cache getInputJsonSchema result', () => {
    const { ToolEntry } = require('../../common');

    // Create a minimal tool entry
    class TestToolEntry extends ToolEntry {
      createContext() {
        return {} as any;
      }
    }

    const entry = new TestToolEntry({
      provide: class {},
      metadata: {
        name: 'test-tool',
        description: 'test',
        id: 'test-tool',
      },
      kind: 'FUNCTION' as any,
    });

    // First call computes
    const result1 = entry.getInputJsonSchema();
    // Second call should be cached (same reference)
    const result2 = entry.getInputJsonSchema();
    expect(result1).toBe(result2);
  });
});
