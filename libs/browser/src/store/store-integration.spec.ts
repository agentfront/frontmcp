// file: libs/browser/src/store/store-integration.spec.ts
/**
 * Tests for store resource and tool integration.
 */

import { createMcpStore } from './store.factory';
import { createStoreResource, createStoreResources } from './store-resource';
import { createStoreSetTool, createStoreMutateTool, createStoreResetTool, createStoreBatchTool } from './store-tool';

interface TestState {
  count: number;
  name: string;
  items: string[];
  config: { theme: 'light' | 'dark' };
}

describe('Store Resource Integration', () => {
  let store: ReturnType<typeof createMcpStore<TestState>>;

  beforeEach(() => {
    store = createMcpStore<TestState>({
      initialState: {
        count: 0,
        name: 'test',
        items: ['a', 'b'],
        config: { theme: 'light' },
      },
    });
  });

  describe('createStoreResource', () => {
    it('should create a resource for entire state', () => {
      const resource = createStoreResource(store, {
        uri: 'app://state',
        name: 'State',
        description: 'Application state',
      });

      expect(resource.uri).toBe('app://state');
      expect(resource.name).toBe('State');
      expect(resource.description).toBe('Application state');
      expect(resource.mimeType).toBe('application/json');
    });

    it('should return current state when handler is called', () => {
      const resource = createStoreResource(store, {
        uri: 'app://state',
        name: 'State',
      });

      const result = resource.handler() as { uri: string; mimeType: string; text: string };

      expect(result.uri).toBe('app://state');
      expect(result.mimeType).toBe('application/json');
      expect(JSON.parse(result.text)).toEqual({
        count: 0,
        name: 'test',
        items: ['a', 'b'],
        config: { theme: 'light' },
      });
    });

    it('should use selector to return subset of state', () => {
      const resource = createStoreResource(store, {
        uri: 'app://config',
        name: 'Config',
        selector: (state) => state.config,
      });

      const result = resource.handler() as { uri: string; mimeType: string; text: string };

      expect(JSON.parse(result.text)).toEqual({ theme: 'light' });
    });

    it('should use custom transform function', () => {
      const resource = createStoreResource(store, {
        uri: 'app://count',
        name: 'Count',
        selector: (state) => state.count,
        transform: (count) => `Count is: ${count}`,
        mimeType: 'text/plain',
      });

      const result = resource.handler() as { uri: string; mimeType: string; text: string };

      expect(result.text).toBe('Count is: 0');
      expect(result.mimeType).toBe('text/plain');
    });

    it('should reflect state changes', () => {
      const resource = createStoreResource(store, {
        uri: 'app://count',
        name: 'Count',
        selector: (state) => state.count,
      });

      // Initial value
      expect(JSON.parse((resource.handler() as { text: string }).text)).toBe(0);

      // Change state
      store.state.count = 42;

      // Should reflect new value
      expect(JSON.parse((resource.handler() as { text: string }).text)).toBe(42);
    });
  });

  describe('createStoreResources', () => {
    it('should create multiple resources from mapping', () => {
      const resources = createStoreResources(store, {
        'app://count': {
          name: 'Count',
          selector: (s) => s.count,
        },
        'app://config': {
          name: 'Config',
          selector: (s) => s.config,
        },
      });

      expect(resources).toHaveLength(2);
      expect(resources[0].uri).toBe('app://count');
      expect(resources[1].uri).toBe('app://config');
    });
  });
});

describe('Store Tool Integration', () => {
  let store: ReturnType<typeof createMcpStore<TestState>>;

  beforeEach(() => {
    store = createMcpStore<TestState>({
      initialState: {
        count: 0,
        name: 'test',
        items: ['a', 'b'],
        config: { theme: 'light' },
      },
    });
  });

  describe('createStoreSetTool', () => {
    it('should create a set tool for a key', () => {
      const tool = createStoreSetTool(store, {
        name: 'set-count',
        description: 'Set the count',
        key: 'count',
      });

      expect(tool.name).toBe('set-count');
      expect(tool.description).toBe('Set the count');
    });

    it('should set the value and return previous value', () => {
      const tool = createStoreSetTool(store, {
        name: 'set-count',
        description: 'Set the count',
        key: 'count',
      });

      const result = tool.handler({ value: 42 }) as { success: boolean; key: string; previousValue: number };

      expect(result.success).toBe(true);
      expect(result.key).toBe('count');
      expect(result.previousValue).toBe(0);
      expect(store.state.count).toBe(42);
    });

    it('should validate input when validate function provided', () => {
      const tool = createStoreSetTool(store, {
        name: 'set-count',
        description: 'Set the count',
        key: 'count',
        validate: (value) => typeof value === 'number' || 'Value must be a number',
      });

      expect(() => tool.handler({ value: 'not a number' })).toThrow('Value must be a number');
    });

    it('should transform input when transform function provided', () => {
      const tool = createStoreSetTool(store, {
        name: 'set-count',
        description: 'Set the count',
        key: 'count',
        transform: (value) => Number(value) * 2,
      });

      tool.handler({ value: 5 });

      expect(store.state.count).toBe(10);
    });
  });

  describe('createStoreMutateTool', () => {
    it('should create a custom mutation tool', () => {
      const tool = createStoreMutateTool(store, {
        name: 'increment',
        description: 'Increment the count',
        mutate: (state, input: { amount?: number }) => {
          state.count += input.amount ?? 1;
          return { newCount: state.count };
        },
      });

      expect(tool.name).toBe('increment');
    });

    it('should execute mutation and return result', () => {
      const tool = createStoreMutateTool(store, {
        name: 'increment',
        description: 'Increment the count',
        mutate: (state, input: { amount?: number }) => {
          state.count += input.amount ?? 1;
          return { newCount: state.count };
        },
      });

      const result = tool.handler({ amount: 5 }) as { newCount: number };

      expect(result.newCount).toBe(5);
      expect(store.state.count).toBe(5);
    });

    it('should support async mutations', async () => {
      const tool = createStoreMutateTool(store, {
        name: 'async-increment',
        description: 'Async increment',
        mutate: async (state, input: { amount: number }) => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          state.count += input.amount;
          return { done: true };
        },
      });

      const result = await tool.handler({ amount: 10 });

      expect(result).toEqual({ done: true });
      expect(store.state.count).toBe(10);
    });
  });

  describe('createStoreResetTool', () => {
    it('should create a reset tool with default options', () => {
      const tool = createStoreResetTool(store);

      expect(tool.name).toBe('reset-state');
      expect(tool.description).toBe('Reset the store to initial state');
    });

    it('should reset store to initial state', () => {
      // Modify state
      store.state.count = 100;
      store.state.name = 'modified';

      const tool = createStoreResetTool(store);
      const result = tool.handler({}) as { success: boolean };

      expect(result.success).toBe(true);
      expect(store.state.count).toBe(0);
      expect(store.state.name).toBe('test');
    });

    it('should accept custom name and description', () => {
      const tool = createStoreResetTool(store, {
        name: 'clear-all',
        description: 'Clear all data',
      });

      expect(tool.name).toBe('clear-all');
      expect(tool.description).toBe('Clear all data');
    });
  });

  describe('createStoreBatchTool', () => {
    it('should create a batch mutation tool', () => {
      const tool = createStoreBatchTool(store, {
        mutations: {
          setCount: (state, value: unknown) => {
            state.count = value as number;
          },
          setName: (state, value: unknown) => {
            state.name = value as string;
          },
        },
      });

      expect(tool.name).toBe('batch-mutate');
    });

    it('should apply multiple mutations in batch', () => {
      const tool = createStoreBatchTool(store, {
        mutations: {
          setCount: (state, value: unknown) => {
            state.count = value as number;
          },
          setName: (state, value: unknown) => {
            state.name = value as string;
          },
        },
      });

      const result = tool.handler({
        operations: [
          { mutation: 'setCount', value: 99 },
          { mutation: 'setName', value: 'updated' },
        ],
      }) as { success: boolean; applied: number };

      expect(result.success).toBe(true);
      expect(result.applied).toBe(2);
      expect(store.state.count).toBe(99);
      expect(store.state.name).toBe('updated');
    });

    it('should skip unknown mutations', () => {
      const tool = createStoreBatchTool(store, {
        mutations: {
          setCount: (state, value: unknown) => {
            state.count = value as number;
          },
        },
      });

      const result = tool.handler({
        operations: [
          { mutation: 'setCount', value: 50 },
          { mutation: 'unknown', value: 'ignored' },
        ],
      }) as { success: boolean; applied: number };

      expect(result.applied).toBe(1);
      expect(store.state.count).toBe(50);
    });
  });
});
