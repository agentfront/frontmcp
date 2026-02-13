/**
 * Unit tests for AdapterInstance
 */

import 'reflect-metadata';
import { AdapterInstance } from '../adapter.instance';
import { AdapterInterface, AdapterKind, AdapterRecord, FrontMcpAdapterResponse, FrontMcpLogger } from '../../common';
import { addProviderToMock, createMockProviderRegistry } from '../../__test-utils__';

// Mock registries to track constructor arguments
const mockToolRegistryInstances: any[] = [];
const mockResourceRegistryInstances: any[] = [];
const mockPromptRegistryInstances: any[] = [];

jest.mock('../../tool/tool.registry', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(function (this: any, providers: any, list: any, owner: any) {
      this.providers = providers;
      this.list = list;
      this.owner = owner;
      this.ready = Promise.resolve();
      this.getTools = jest.fn().mockReturnValue([]);
      mockToolRegistryInstances.push(this);
    }),
  };
});

jest.mock('../../resource/resource.registry', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(function (this: any, providers: any, list: any, owner: any) {
      this.providers = providers;
      this.list = list;
      this.owner = owner;
      this.ready = Promise.resolve();
      this.getResources = jest.fn().mockReturnValue([]);
      mockResourceRegistryInstances.push(this);
    }),
  };
});

jest.mock('../../prompt/prompt.registry', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(function (this: any, providers: any, list: any, owner: any) {
      this.providers = providers;
      this.list = list;
      this.owner = owner;
      this.ready = Promise.resolve();
      this.getPrompts = jest.fn().mockReturnValue([]);
      mockPromptRegistryInstances.push(this);
    }),
  };
});

/** Creates a mock adapter interface */
function createMockAdapter(
  name: string,
  response: FrontMcpAdapterResponse = { tools: [] },
  opts?: { description?: string; setLogger?: jest.Mock },
): AdapterInterface {
  const adapter: AdapterInterface = {
    options: { name, ...(opts?.description ? { description: opts.description } : {}) },
    fetch: jest.fn().mockResolvedValue(response),
  };
  if (opts?.setLogger) {
    adapter.setLogger = opts.setLogger;
  }
  return adapter;
}

/** Creates a mock logger */
function createMockLogger(): FrontMcpLogger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    verbose: jest.fn(),
    child: jest.fn().mockReturnThis(),
  } as unknown as FrontMcpLogger;
}

describe('AdapterInstance', () => {
  let mockProviders: ReturnType<typeof createMockProviderRegistry>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockToolRegistryInstances.length = 0;
    mockResourceRegistryInstances.length = 0;
    mockPromptRegistryInstances.length = 0;
    mockProviders = createMockProviderRegistry({
      resolveBootstrapDep: jest.fn().mockResolvedValue('resolved-dep'),
    });
  });

  describe('Initialization per kind', () => {
    it('should construct adapter from useValue for VALUE kind', async () => {
      const adapter = createMockAdapter('value-adapter');
      const TOKEN = Symbol('ADAPTER');

      const record: AdapterRecord = {
        kind: AdapterKind.VALUE,
        provide: TOKEN,
        useValue: adapter,
        metadata: { name: 'value-adapter' },
      };

      const instance = new AdapterInstance(record, new Set(), mockProviders);
      await instance.ready;

      expect(adapter.fetch).toHaveBeenCalled();
    });

    it('should construct adapter via new useClass for CLASS kind', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ tools: [] });
      class TestAdapterImpl implements AdapterInterface {
        options = { name: 'class-adapter' };
        receivedDeps: any[];
        constructor(...deps: any[]) {
          this.receivedDeps = deps;
        }
        fetch = mockFetch;
      }

      const TOKEN = Symbol('ADAPTER');
      const record: AdapterRecord = {
        kind: AdapterKind.CLASS,
        provide: TOKEN,
        useClass: TestAdapterImpl,
        metadata: { name: 'class-adapter' },
      };

      const instance = new AdapterInstance(record, new Set(), mockProviders);
      await instance.ready;

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should construct adapter via new provide for CLASS_TOKEN kind', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ tools: [] });

      class TokenAdapter implements AdapterInterface {
        options = { name: 'token-adapter' };
        fetch = mockFetch;
      }

      const record: AdapterRecord = {
        kind: AdapterKind.CLASS_TOKEN,
        provide: TokenAdapter,
        metadata: { name: 'token-adapter' },
      };

      const instance = new AdapterInstance(record, new Set(), mockProviders);
      await instance.ready;

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should construct adapter via useFactory for FACTORY kind', async () => {
      const adapter = createMockAdapter('factory-adapter');
      const DEP = Symbol('DEP');
      const TOKEN = Symbol('ADAPTER');

      const factory = jest.fn().mockReturnValue(adapter);

      const record: AdapterRecord = {
        kind: AdapterKind.FACTORY,
        provide: TOKEN,
        useFactory: factory,
        inject: () => [DEP],
        metadata: { name: 'factory-adapter' },
      };

      const instance = new AdapterInstance(record, new Set(), mockProviders);
      await instance.ready;

      expect(factory).toHaveBeenCalledWith('resolved-dep');
      expect(adapter.fetch).toHaveBeenCalled();
    });

    it('should resolve dependencies before constructing CLASS adapter', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ tools: [] });
      class DepsAdapter implements AdapterInterface {
        options = { name: 'deps-adapter' };
        receivedDeps: any[];
        constructor(...deps: any[]) {
          this.receivedDeps = deps;
        }
        fetch = mockFetch;
      }

      const DEP1 = Symbol('DEP1');
      const DEP2 = Symbol('DEP2');
      const TOKEN = Symbol('ADAPTER');

      (mockProviders.resolveBootstrapDep as jest.Mock)
        .mockResolvedValueOnce('dep1-value')
        .mockResolvedValueOnce('dep2-value');

      const record: AdapterRecord = {
        kind: AdapterKind.CLASS,
        provide: TOKEN,
        useClass: DepsAdapter,
        metadata: { name: 'deps-adapter' },
      };

      const instance = new AdapterInstance(record, new Set([DEP1, DEP2]), mockProviders);
      await instance.ready;

      expect(mockProviders.resolveBootstrapDep).toHaveBeenCalledWith(DEP1);
      expect(mockProviders.resolveBootstrapDep).toHaveBeenCalledWith(DEP2);
    });

    it('should throw for invalid adapter kind', async () => {
      const TOKEN = Symbol('ADAPTER');
      const record = {
        kind: 'INVALID' as any,
        provide: TOKEN,
        metadata: { name: 'invalid' },
      } as any;

      const instance = new AdapterInstance(record, new Set(), mockProviders);
      await expect(instance.ready).rejects.toThrow('Invalid adapter kind');
    });
  });

  describe('Resource/Prompt support', () => {
    it('should create all three registries with correct lists and owner', async () => {
      const mockTools = [{ name: 'tool1' }];
      const mockResources = [{ name: 'res1' }];
      const mockPrompts = [{ name: 'prompt1' }];

      const adapter = createMockAdapter('full-adapter', {
        tools: mockTools as any,
        resources: mockResources as any,
        prompts: mockPrompts as any,
      });

      const TOKEN = Symbol('ADAPTER');
      const record: AdapterRecord = {
        kind: AdapterKind.VALUE,
        provide: TOKEN,
        useValue: adapter,
        metadata: { name: 'full-adapter' },
      };

      const instance = new AdapterInstance(record, new Set(), mockProviders);
      await instance.ready;

      // Verify ToolRegistry was created with tools and correct owner
      expect(mockToolRegistryInstances).toHaveLength(1);
      expect(mockToolRegistryInstances[0].list).toEqual(mockTools);
      expect(mockToolRegistryInstances[0].owner).toEqual({
        kind: 'adapter',
        id: 'full-adapter',
        ref: TOKEN,
      });

      // Verify ResourceRegistry was created with resources and correct owner
      expect(mockResourceRegistryInstances).toHaveLength(1);
      expect(mockResourceRegistryInstances[0].list).toEqual(mockResources);
      expect(mockResourceRegistryInstances[0].owner).toEqual({
        kind: 'adapter',
        id: 'full-adapter',
        ref: TOKEN,
      });

      // Verify PromptRegistry was created with prompts and correct owner
      expect(mockPromptRegistryInstances).toHaveLength(1);
      expect(mockPromptRegistryInstances[0].list).toEqual(mockPrompts);
      expect(mockPromptRegistryInstances[0].owner).toEqual({
        kind: 'adapter',
        id: 'full-adapter',
        ref: TOKEN,
      });
    });

    it('should create registries with empty arrays when adapter returns only tools', async () => {
      const adapter = createMockAdapter('tools-only', { tools: [{ name: 'tool1' }] as any });
      const TOKEN = Symbol('ADAPTER');

      const record: AdapterRecord = {
        kind: AdapterKind.VALUE,
        provide: TOKEN,
        useValue: adapter,
        metadata: { name: 'tools-only' },
      };

      const instance = new AdapterInstance(record, new Set(), mockProviders);
      await instance.ready;

      expect(mockResourceRegistryInstances[0].list).toEqual([]);
      expect(mockPromptRegistryInstances[0].list).toEqual([]);
    });

    it('should create registries with empty arrays when adapter returns empty object', async () => {
      const adapter = createMockAdapter('empty', {});
      const TOKEN = Symbol('ADAPTER');

      const record: AdapterRecord = {
        kind: AdapterKind.VALUE,
        provide: TOKEN,
        useValue: adapter,
        metadata: { name: 'empty' },
      };

      const instance = new AdapterInstance(record, new Set(), mockProviders);
      await instance.ready;

      expect(mockToolRegistryInstances[0].list).toEqual([]);
      expect(mockResourceRegistryInstances[0].list).toEqual([]);
      expect(mockPromptRegistryInstances[0].list).toEqual([]);
    });
  });

  describe('Logger injection', () => {
    it('should call setLogger on adapter that supports it', async () => {
      const logger = createMockLogger();
      addProviderToMock(mockProviders, FrontMcpLogger, logger);

      const setLogger = jest.fn();
      const adapter = createMockAdapter('logged-adapter', { tools: [] }, { setLogger });
      const TOKEN = Symbol('ADAPTER');

      const record: AdapterRecord = {
        kind: AdapterKind.VALUE,
        provide: TOKEN,
        useValue: adapter,
        metadata: { name: 'logged-adapter' },
      };

      const instance = new AdapterInstance(record, new Set(), mockProviders);
      await instance.ready;

      expect(setLogger).toHaveBeenCalled();
    });

    it('should not error when adapter does not have setLogger', async () => {
      const logger = createMockLogger();
      addProviderToMock(mockProviders, FrontMcpLogger, logger);

      const adapter = createMockAdapter('no-logger');
      const TOKEN = Symbol('ADAPTER');

      const record: AdapterRecord = {
        kind: AdapterKind.VALUE,
        provide: TOKEN,
        useValue: adapter,
        metadata: { name: 'no-logger' },
      };

      const instance = new AdapterInstance(record, new Set(), mockProviders);
      await expect(instance.ready).resolves.toBeUndefined();
    });

    it('should not call setLogger when logger is not available', async () => {
      const setLogger = jest.fn();
      const adapter = createMockAdapter('no-provider-logger', { tools: [] }, { setLogger });
      const TOKEN = Symbol('ADAPTER');

      const record: AdapterRecord = {
        kind: AdapterKind.VALUE,
        provide: TOKEN,
        useValue: adapter,
        metadata: { name: 'no-provider-logger' },
      };

      const instance = new AdapterInstance(record, new Set(), mockProviders);
      await instance.ready;

      expect(setLogger).not.toHaveBeenCalled();
    });
  });

  describe('Getters', () => {
    it('should return correct registry instances from getTools/getResources/getPrompts', async () => {
      const adapter = createMockAdapter('getter-adapter', {
        tools: [{ name: 't' }] as any,
        resources: [{ name: 'r' }] as any,
        prompts: [{ name: 'p' }] as any,
      });

      const TOKEN = Symbol('ADAPTER');
      const record: AdapterRecord = {
        kind: AdapterKind.VALUE,
        provide: TOKEN,
        useValue: adapter,
        metadata: { name: 'getter-adapter' },
      };

      const instance = new AdapterInstance(record, new Set(), mockProviders);
      await instance.ready;

      expect(instance.getTools()).toBe(mockToolRegistryInstances[0]);
      expect(instance.getResources()).toBe(mockResourceRegistryInstances[0]);
      expect(instance.getPrompts()).toBe(mockPromptRegistryInstances[0]);
    });
  });

  describe('Error cases', () => {
    it('should propagate error when adapter fetch() throws', async () => {
      const adapter: AdapterInterface = {
        options: { name: 'failing-adapter' },
        fetch: jest.fn().mockRejectedValue(new Error('Fetch failed')),
      };

      const TOKEN = Symbol('ADAPTER');
      const record: AdapterRecord = {
        kind: AdapterKind.VALUE,
        provide: TOKEN,
        useValue: adapter,
        metadata: { name: 'failing-adapter' },
      };

      const instance = new AdapterInstance(record, new Set(), mockProviders);
      await expect(instance.ready).rejects.toThrow('Fetch failed');
    });
  });

  describe('Logging', () => {
    it('should log lifecycle events when logger is available', async () => {
      const logger = createMockLogger();
      addProviderToMock(mockProviders, FrontMcpLogger, logger);

      const adapter = createMockAdapter('logged', {
        tools: [{ name: 't' }] as any,
        resources: [{ name: 'r' }] as any,
        prompts: [],
      });

      const TOKEN = Symbol('ADAPTER');
      const record: AdapterRecord = {
        kind: AdapterKind.VALUE,
        provide: TOKEN,
        useValue: adapter,
        metadata: { name: 'logged' },
      };

      const instance = new AdapterInstance(record, new Set(), mockProviders);
      await instance.ready;

      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Resolving 0 dependency'));
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Adapter constructed'));
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Fetching adapter response'));
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('1 tool(s), 1 resource(s), 0 prompt(s)'));
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('registries initialized'));
    });

    it('should log description when adapter has one', async () => {
      const logger = createMockLogger();
      addProviderToMock(mockProviders, FrontMcpLogger, logger);

      const adapter = createMockAdapter('desc-adapter', { tools: [] }, { description: 'My description' });

      const TOKEN = Symbol('ADAPTER');
      const record: AdapterRecord = {
        kind: AdapterKind.VALUE,
        provide: TOKEN,
        useValue: adapter,
        metadata: { name: 'desc-adapter' },
      };

      const instance = new AdapterInstance(record, new Set(), mockProviders);
      await instance.ready;

      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('My description'));
    });
  });
});
