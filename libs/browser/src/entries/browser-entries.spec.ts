// file: libs/browser/src/entries/browser-entries.spec.ts
/**
 * Tests for browser-specific entry classes.
 */

import { BrowserToolEntry, type BrowserStore, type UIResourceOptions } from './browser-tool.entry';
import { BrowserResourceEntry } from './browser-resource.entry';
import { BrowserPromptEntry } from './browser-prompt.entry';
import { ToolEntry, ResourceEntry, PromptEntry } from '@frontmcp/sdk/core';

// Mock store implementation for testing
function createMockStore<T extends object>(initialState: T): BrowserStore<T> {
  let state = { ...initialState };
  const listeners = new Set<(state: T) => void>();
  const keyListeners = new Map<keyof T, Set<(value: unknown) => void>>();

  return {
    state,
    getSnapshot: () => ({ ...state }),
    subscribe: (listener: (state: T) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeKey: <K extends keyof T>(key: K, listener: (value: T[K]) => void) => {
      if (!keyListeners.has(key)) {
        keyListeners.set(key, new Set());
      }
      const set = keyListeners.get(key)!;
      set.add(listener as (value: unknown) => void);
      return () => set.delete(listener as (value: unknown) => void);
    },
  };
}

// Mock component registry
function createMockComponentRegistry() {
  const components = new Map<string, unknown>();
  return {
    register: (name: string, component: unknown) => components.set(name, component),
    get: (name: string) => components.get(name),
    has: (name: string) => components.has(name),
    list: () => Array.from(components.keys()),
  };
}

// Mock renderer registry
function createMockRendererRegistry() {
  const renderers = new Map<string, unknown>();
  return {
    register: (name: string, renderer: unknown) => renderers.set(name, renderer),
    get: (name: string) => renderers.get(name),
    has: (name: string) => renderers.has(name),
    list: () => Array.from(renderers.keys()),
  };
}

// Mock records for SDK base entry constructors
function createMockToolRecord() {
  return {
    provide: Symbol('TestTool'),
    metadata: { name: 'test-tool', description: 'A test tool' },
  };
}

function createMockResourceRecord() {
  return {
    provide: Symbol('TestResource'),
    metadata: { name: 'test-resource', uri: 'test://resource', description: 'A test resource' },
  };
}

function createMockPromptRecord() {
  return {
    provide: Symbol('TestPrompt'),
    metadata: { name: 'test-prompt', description: 'A test prompt' },
  };
}

describe('BrowserToolEntry', () => {
  // Create a concrete implementation for testing
  class TestTool extends BrowserToolEntry {
    constructor() {
      super(createMockToolRecord() as any);
    }

    // Implement abstract methods from SDK entries
    protected async initialize(): Promise<void> {
      // No initialization needed for tests
    }

    // Implement abstract methods from SDK ToolEntry
    create() {
      return {} as any;
    }

    parseInput(input: any) {
      return input.arguments ?? {};
    }

    parseOutput(result: any) {
      return { content: [{ type: 'text' as const, text: String(result) }] };
    }

    safeParseOutput(raw: any) {
      try {
        return { success: true as const, data: this.parseOutput(raw) };
      } catch (error) {
        return { success: false as const, error: error as Error };
      }
    }
  }

  it('should extend SDK ToolEntry', () => {
    const tool = new TestTool();
    expect(tool).toBeInstanceOf(ToolEntry);
  });

  describe('browser context', () => {
    let tool: TestTool;
    let mockStore: BrowserStore<{ count: number }>;
    let mockComponentRegistry: ReturnType<typeof createMockComponentRegistry>;
    let mockRendererRegistry: ReturnType<typeof createMockRendererRegistry>;

    beforeEach(() => {
      tool = new TestTool();
      mockStore = createMockStore({ count: 0 });
      mockComponentRegistry = createMockComponentRegistry();
      mockRendererRegistry = createMockRendererRegistry();
    });

    it('should return false for hasBrowserContext when not set', () => {
      expect(tool.hasBrowserContext()).toBe(false);
    });

    it('should return true for hasBrowserContext when set', () => {
      tool.setBrowserContext({
        store: mockStore,
        componentRegistry: mockComponentRegistry,
        rendererRegistry: mockRendererRegistry,
      });
      expect(tool.hasBrowserContext()).toBe(true);
    });

    it('should throw when getStore called without context', () => {
      expect(() => tool.getStore()).toThrow('Store not available');
    });

    it('should return undefined from tryGetStore without context', () => {
      expect(tool.tryGetStore()).toBeUndefined();
    });

    it('should return store when context is set', () => {
      tool.setBrowserContext({ store: mockStore });
      const store = tool.getStore<{ count: number }>();
      expect(store.state.count).toBe(0);
    });

    it('should return store from tryGetStore when context is set', () => {
      tool.setBrowserContext({ store: mockStore });
      const store = tool.tryGetStore<{ count: number }>();
      expect(store?.state.count).toBe(0);
    });

    it('should throw when getComponentRegistry called without context', () => {
      expect(() => tool.getComponentRegistry()).toThrow('Component registry not available');
    });

    it('should return undefined from tryGetComponentRegistry without context', () => {
      expect(tool.tryGetComponentRegistry()).toBeUndefined();
    });

    it('should return component registry when context is set', () => {
      tool.setBrowserContext({ componentRegistry: mockComponentRegistry });
      const registry = tool.getComponentRegistry();
      expect(registry.list()).toEqual([]);
    });

    it('should throw when getRendererRegistry called without context', () => {
      expect(() => tool.getRendererRegistry()).toThrow('Renderer registry not available');
    });

    it('should return undefined from tryGetRendererRegistry without context', () => {
      expect(tool.tryGetRendererRegistry()).toBeUndefined();
    });

    it('should return renderer registry when context is set', () => {
      tool.setBrowserContext({ rendererRegistry: mockRendererRegistry });
      const registry = tool.getRendererRegistry();
      expect(registry.list()).toEqual([]);
    });
  });

  describe('createUIResource', () => {
    let tool: TestTool;

    beforeEach(() => {
      tool = new TestTool();
    });

    it('should create a UI resource with component only', () => {
      const resource = tool.createUIResource({ component: 'Button' });
      expect(resource).toEqual({
        type: 'ui-resource',
        component: 'Button',
        props: {},
        renderer: undefined,
      });
    });

    it('should create a UI resource with all options', () => {
      const resource = tool.createUIResource({
        component: 'DataTable',
        props: { data: [1, 2, 3] },
        renderer: 'html',
      });
      expect(resource).toEqual({
        type: 'ui-resource',
        component: 'DataTable',
        props: { data: [1, 2, 3] },
        renderer: 'html',
      });
    });
  });
});

describe('BrowserResourceEntry', () => {
  // Create a concrete implementation for testing
  class TestResource extends BrowserResourceEntry {
    constructor() {
      super(createMockResourceRecord() as any);
    }

    // Implement abstract methods from SDK entries
    protected async initialize(): Promise<void> {
      // No initialization needed for tests
    }

    // Implement abstract methods from SDK ResourceEntry
    create() {
      return {} as any;
    }

    parseOutput(result: any) {
      return { contents: [{ uri: 'test://resource', mimeType: 'text/plain', text: String(result) }] };
    }

    safeParseOutput(raw: any) {
      try {
        return { success: true as const, data: this.parseOutput(raw) };
      } catch (error) {
        return { success: false as const, error: error as Error };
      }
    }

    matchUri(uri: string) {
      return { matches: uri === 'test://resource', params: {} as Record<string, string> };
    }
  }

  it('should extend SDK ResourceEntry', () => {
    const resource = new TestResource();
    expect(resource).toBeInstanceOf(ResourceEntry);
  });

  describe('browser context', () => {
    let resource: TestResource;
    let mockStore: BrowserStore<{ data: string }>;

    beforeEach(() => {
      resource = new TestResource();
      mockStore = createMockStore({ data: 'test' });
    });

    it('should return false for hasBrowserContext when not set', () => {
      expect(resource.hasBrowserContext()).toBe(false);
    });

    it('should return true for hasBrowserContext when set', () => {
      resource.setBrowserContext({ store: mockStore });
      expect(resource.hasBrowserContext()).toBe(true);
    });

    it('should throw when getStore called without context', () => {
      expect(() => resource.getStore()).toThrow('Store not available');
    });

    it('should return undefined from tryGetStore without context', () => {
      expect(resource.tryGetStore()).toBeUndefined();
    });

    it('should return store when context is set', () => {
      resource.setBrowserContext({ store: mockStore });
      const store = resource.getStore<{ data: string }>();
      expect(store.state.data).toBe('test');
    });
  });

  describe('subscribeToStoreKey', () => {
    let resource: TestResource;
    let mockStore: BrowserStore<{ count: number }>;

    beforeEach(() => {
      resource = new TestResource();
      mockStore = createMockStore({ count: 0 });
    });

    it('should throw when store is not available', () => {
      expect(() => resource.subscribeToStoreKey<{ count: number }, 'count'>('count', () => {})).toThrow(
        'Store not available',
      );
    });

    it('should return unsubscribe function', () => {
      resource.setBrowserContext({ store: mockStore });
      const unsubscribe = resource.subscribeToStoreKey<{ count: number }, 'count'>('count', () => {});
      expect(typeof unsubscribe).toBe('function');
    });
  });

  describe('content helpers', () => {
    let resource: TestResource;

    beforeEach(() => {
      resource = new TestResource();
    });

    it('should create JSON content', () => {
      const content = (resource as any).createJsonContent('test://data', { foo: 'bar' });
      expect(content).toEqual({
        uri: 'test://data',
        mimeType: 'application/json',
        text: JSON.stringify({ foo: 'bar' }, null, 2),
      });
    });

    it('should create text content with default mime type', () => {
      const content = (resource as any).createTextContent('test://text', 'Hello');
      expect(content).toEqual({
        uri: 'test://text',
        mimeType: 'text/plain',
        text: 'Hello',
      });
    });

    it('should create text content with custom mime type', () => {
      const content = (resource as any).createTextContent('test://html', '<h1>Hi</h1>', 'text/html');
      expect(content).toEqual({
        uri: 'test://html',
        mimeType: 'text/html',
        text: '<h1>Hi</h1>',
      });
    });
  });
});

describe('BrowserPromptEntry', () => {
  // Create a concrete implementation for testing
  class TestPrompt extends BrowserPromptEntry {
    constructor() {
      super(createMockPromptRecord() as any);
    }

    // Implement abstract methods from SDK entries
    protected async initialize(): Promise<void> {
      // No initialization needed for tests
    }

    // Implement abstract methods from SDK PromptEntry
    create() {
      return {} as any;
    }

    parseArguments(args?: Record<string, string>) {
      return args ?? {};
    }

    parseOutput(raw: any) {
      return {
        messages: [{ role: 'user' as const, content: { type: 'text' as const, text: String(raw) } }],
      };
    }

    safeParseOutput(raw: any) {
      try {
        return { success: true as const, data: this.parseOutput(raw) };
      } catch (error) {
        return { success: false as const, error: error as Error };
      }
    }
  }

  it('should extend SDK PromptEntry', () => {
    const prompt = new TestPrompt();
    expect(prompt).toBeInstanceOf(PromptEntry);
  });

  describe('browser context', () => {
    let prompt: TestPrompt;
    let mockStore: BrowserStore<{ style: string }>;

    beforeEach(() => {
      prompt = new TestPrompt();
      mockStore = createMockStore({ style: 'formal' });
    });

    it('should return false for hasBrowserContext when not set', () => {
      expect(prompt.hasBrowserContext()).toBe(false);
    });

    it('should return true for hasBrowserContext when set', () => {
      prompt.setBrowserContext({ store: mockStore });
      expect(prompt.hasBrowserContext()).toBe(true);
    });

    it('should throw when getStore called without context', () => {
      expect(() => prompt.getStore()).toThrow('Store not available');
    });

    it('should return undefined from tryGetStore without context', () => {
      expect(prompt.tryGetStore()).toBeUndefined();
    });

    it('should return store when context is set', () => {
      prompt.setBrowserContext({ store: mockStore });
      const store = prompt.getStore<{ style: string }>();
      expect(store.state.style).toBe('formal');
    });

    it('should return store from tryGetStore when context is set', () => {
      prompt.setBrowserContext({ store: mockStore });
      const store = prompt.tryGetStore<{ style: string }>();
      expect(store?.state.style).toBe('formal');
    });
  });
});
