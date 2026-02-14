/**
 * create() Factory Function Tests
 */

import 'reflect-metadata';
import type { DirectMcpServer } from '../direct.types';
import type { DirectClient } from '../client.types';
import type { CreateConfig } from '../create.types';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockDispose = jest.fn().mockResolvedValue(undefined);

const mockClient = {} as unknown as DirectClient;

const mockServer: DirectMcpServer = {
  ready: Promise.resolve(),
  listTools: jest.fn().mockResolvedValue({ tools: [] }),
  callTool: jest.fn().mockResolvedValue({ content: [] }),
  listResources: jest.fn().mockResolvedValue({ resources: [] }),
  listResourceTemplates: jest.fn().mockResolvedValue({ resourceTemplates: [] }),
  readResource: jest.fn().mockResolvedValue({ contents: [] }),
  listPrompts: jest.fn().mockResolvedValue({ prompts: [] }),
  getPrompt: jest.fn().mockResolvedValue({ messages: [] }),
  connect: jest.fn().mockResolvedValue(mockClient),
  dispose: mockDispose,
};

const mockCreateDirect = jest.fn().mockResolvedValue(mockServer);

jest.mock('../../front-mcp/front-mcp', () => ({
  FrontMcpInstance: {
    createDirect: (...args: unknown[]) => mockCreateDirect(...args),
  },
}));

const mockSetMachineIdOverride = jest.fn();

jest.mock('@frontmcp/auth', () => {
  const actual = jest.requireActual('@frontmcp/auth');
  return {
    ...actual,
    setMachineIdOverride: (...args: unknown[]) => mockSetMachineIdOverride(...args),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('create() factory', () => {
  let create: typeof import('../create').create;
  let clearCreateCache: typeof import('../create').clearCreateCache;
  let buildConfig: typeof import('../create').buildConfig;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Reset module to clear cache
    jest.resetModules();

    // Re-setup mocks after resetModules
    jest.mock('../../front-mcp/front-mcp', () => ({
      FrontMcpInstance: {
        createDirect: (...args: unknown[]) => mockCreateDirect(...args),
      },
    }));
    jest.mock('@frontmcp/auth', () => {
      const actual = jest.requireActual('@frontmcp/auth');
      return {
        ...actual,
        setMachineIdOverride: (...args: unknown[]) => mockSetMachineIdOverride(...args),
      };
    });

    // Fresh import to get clean cache state
    const mod = await import('../create');
    create = mod.create;
    clearCreateCache = mod.clearCreateCache;
    buildConfig = mod.buildConfig;

    // Reset mockServer.dispose to its original mock (may have been wrapped by previous test)
    mockServer.dispose = mockDispose;
  });

  // Helper for minimal config
  const minimalConfig = (): CreateConfig => ({
    info: { name: 'test-service', version: '1.0.0' },
  });

  // ─────────────────────────────────────────────────────────────────────
  // buildConfig
  // ─────────────────────────────────────────────────────────────────────

  describe('buildConfig', () => {
    it('should wrap app-level fields into apps array', () => {
      const config: CreateConfig = {
        info: { name: 'my-service', version: '1.0.0' },
        tools: [class MyTool {}],
        plugins: [class MyPlugin {}],
      };

      const result = buildConfig(config);

      expect(result.info).toEqual({ name: 'my-service', version: '1.0.0' });
      expect(result.apps).toHaveLength(1);
      expect(result.serve).toBe(false);
    });

    it('should use appName for the synthetic app when provided', () => {
      const config: CreateConfig = {
        info: { name: 'my-service', version: '1.0.0' },
        appName: 'custom-app',
      };

      const result = buildConfig(config);
      const app = result.apps[0];

      expect(app.name).toBe('custom-app');
    });

    it('should default appName to info.name', () => {
      const config: CreateConfig = {
        info: { name: 'my-service', version: '1.0.0' },
      };

      const result = buildConfig(config);
      const app = result.apps[0];

      expect(app.name).toBe('my-service');
    });

    it('should pass server-level fields through', () => {
      const config: CreateConfig = {
        info: { name: 'test', version: '1.0.0' },
        logging: { level: 'debug' },
        pagination: { defaultPageSize: 50 },
      };

      const result = buildConfig(config);

      expect(result.logging).toEqual({ level: 'debug' });
      expect(result.pagination).toEqual({ defaultPageSize: 50 });
    });

    it('should not include machineId or cacheKey in the output config', () => {
      const config: CreateConfig = {
        info: { name: 'test', version: '1.0.0' },
        machineId: 'my-machine-id',
        cacheKey: 'my-cache-key',
      };

      const result = buildConfig(config);

      expect(result).not.toHaveProperty('machineId');
      expect(result).not.toHaveProperty('cacheKey');
    });

    it('should attach metadata tokens to synthetic app class', () => {
      const config: CreateConfig = {
        info: { name: 'test', version: '1.0.0' },
        tools: [class T {}],
        resources: [class R {}],
      };

      const result = buildConfig(config);
      const app = result.apps[0];

      // Verify metadata keys were set using symbol descriptions
      // (Symbols are recreated after jest.resetModules, so we match by description)
      const keys = Reflect.getMetadataKeys(app) as symbol[];
      const keyDescriptions = keys.map((k) => k.description);

      expect(keyDescriptions).toContain('FrontMcp:type:app');
      expect(keyDescriptions).toContain('FrontMcp:meta:name');
      expect(keyDescriptions).toContain('FrontMcp:meta:tools');
      expect(keyDescriptions).toContain('FrontMcp:meta:resources');

      // Verify values via the actual keys
      const typeKey = keys.find((k) => k.description === 'FrontMcp:type:app');
      const nameKey = keys.find((k) => k.description === 'FrontMcp:meta:name');
      const toolsKey = keys.find((k) => k.description === 'FrontMcp:meta:tools');

      expect(Reflect.getMetadata(typeKey, app)).toBe(true);
      expect(Reflect.getMetadata(nameKey, app)).toBe('test');
      expect(Reflect.getMetadata(toolsKey, app)).toEqual(config.tools);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // create()
  // ─────────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should return a DirectMcpServer', async () => {
      const server = await create(minimalConfig());

      expect(server).toBeDefined();
      expect(server.listTools).toBeDefined();
      expect(server.callTool).toBeDefined();
      expect(server.dispose).toBeDefined();
    });

    it('should call FrontMcpInstance.createDirect with built config', async () => {
      await create(minimalConfig());

      expect(mockCreateDirect).toHaveBeenCalledTimes(1);
      const passedConfig = mockCreateDirect.mock.calls[0][0];
      expect(passedConfig.info).toEqual({ name: 'test-service', version: '1.0.0' });
      expect(passedConfig.serve).toBe(false);
      expect(passedConfig.apps).toHaveLength(1);
    });

    it('should not call setMachineIdOverride when machineId is not provided', async () => {
      await create(minimalConfig());

      expect(mockSetMachineIdOverride).not.toHaveBeenCalled();
    });

    it('should call setMachineIdOverride when machineId is provided', async () => {
      await create({ ...minimalConfig(), machineId: 'my-stable-id' });

      expect(mockSetMachineIdOverride).toHaveBeenCalledWith('my-stable-id');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Caching
  // ─────────────────────────────────────────────────────────────────────

  describe('caching', () => {
    it('should return the same promise for the same cacheKey', async () => {
      const config = { ...minimalConfig(), cacheKey: 'tenant-1' };

      const promise1 = create(config);
      const promise2 = create(config);

      const server1 = await promise1;
      const server2 = await promise2;

      expect(server1).toBe(server2);
      expect(mockCreateDirect).toHaveBeenCalledTimes(1);
    });

    it('should create separate instances for different cacheKeys', async () => {
      const mockServer2: DirectMcpServer = {
        ...mockServer,
        dispose: jest.fn().mockResolvedValue(undefined),
      };
      mockCreateDirect.mockResolvedValueOnce(mockServer).mockResolvedValueOnce(mockServer2);

      const s1 = await create({ ...minimalConfig(), cacheKey: 'key-a' });
      const s2 = await create({ ...minimalConfig(), cacheKey: 'key-b' });

      expect(s1).not.toBe(s2);
      expect(mockCreateDirect).toHaveBeenCalledTimes(2);
    });

    it('should not cache when cacheKey is not provided', async () => {
      await create(minimalConfig());
      await create(minimalConfig());

      expect(mockCreateDirect).toHaveBeenCalledTimes(2);
    });

    it('should evict from cache on dispose', async () => {
      const config = { ...minimalConfig(), cacheKey: 'evict-test' };

      const server = await create(config);
      await server.dispose();

      expect(mockDispose).toHaveBeenCalledTimes(1);

      // After dispose, creating with same key should make a new instance
      mockCreateDirect.mockResolvedValueOnce({
        ...mockServer,
        dispose: jest.fn().mockResolvedValue(undefined),
      });

      await create(config);
      expect(mockCreateDirect).toHaveBeenCalledTimes(2);
    });

    it('should evict from cache on init failure', async () => {
      const error = new Error('init failed');
      mockCreateDirect.mockRejectedValueOnce(error);

      const config = { ...minimalConfig(), cacheKey: 'fail-test' };

      await expect(create(config)).rejects.toThrow('init failed');

      // Retry should be allowed (not stuck on failed promise)
      mockCreateDirect.mockResolvedValueOnce(mockServer);
      const server = await create(config);
      expect(server).toBeDefined();
      expect(mockCreateDirect).toHaveBeenCalledTimes(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // clearCreateCache
  // ─────────────────────────────────────────────────────────────────────

  describe('clearCreateCache', () => {
    it('should clear all cached instances', async () => {
      const config = { ...minimalConfig(), cacheKey: 'clear-test' };
      await create(config);

      clearCreateCache();

      // After clearing, same key should create a new instance
      mockCreateDirect.mockResolvedValueOnce({
        ...mockServer,
        dispose: jest.fn().mockResolvedValue(undefined),
      });

      await create(config);
      expect(mockCreateDirect).toHaveBeenCalledTimes(2);
    });
  });
});
