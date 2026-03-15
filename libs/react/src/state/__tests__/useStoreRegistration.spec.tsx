import { renderHook, act } from '@testing-library/react';
import { useStoreRegistration } from '../useStoreRegistration';
import { DynamicRegistry } from '../../registry/DynamicRegistry';
import type { StoreAdapter } from '../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockStore(initialState: Record<string, unknown>) {
  let state = { ...initialState };
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    setState: (next: Record<string, unknown>) => {
      state = { ...state, ...next };
      listeners.forEach((l) => {
        l();
      });
    },
    subscribe: (cb: () => void): (() => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useStoreRegistration', () => {
  let dynamicRegistry: DynamicRegistry;

  beforeEach(() => {
    dynamicRegistry = new DynamicRegistry();
  });

  it('registers main state resource for each adapter', () => {
    const storeA = createMockStore({ a: 1 });
    const storeB = createMockStore({ b: 2 });

    const stores: StoreAdapter[] = [
      { name: 'alpha', getState: storeA.getState, subscribe: storeA.subscribe },
      { name: 'beta', getState: storeB.getState, subscribe: storeB.subscribe },
    ];

    renderHook(() => useStoreRegistration(stores, dynamicRegistry));

    expect(dynamicRegistry.hasResource('state://alpha')).toBe(true);
    expect(dynamicRegistry.hasResource('state://beta')).toBe(true);

    const alphaRes = dynamicRegistry.findResource('state://alpha');
    expect(alphaRes).toBeDefined();
    expect(alphaRes!.name).toBe('alpha-state');
    expect(alphaRes!.description).toBe('Full state of alpha store');
    expect(alphaRes!.mimeType).toBe('application/json');

    const betaRes = dynamicRegistry.findResource('state://beta');
    expect(betaRes).toBeDefined();
    expect(betaRes!.name).toBe('beta-state');
  });

  it('resource read returns current state as JSON', async () => {
    const store = createMockStore({ count: 42, label: 'hello' });

    const stores: StoreAdapter[] = [{ name: 'mystore', getState: store.getState, subscribe: store.subscribe }];

    renderHook(() => useStoreRegistration(stores, dynamicRegistry));

    const resource = dynamicRegistry.findResource('state://mystore')!;
    const result = await resource.read();

    expect(result.contents).toEqual([
      {
        uri: 'state://mystore',
        mimeType: 'application/json',
        text: JSON.stringify({ count: 42, label: 'hello' }),
      },
    ]);
  });

  it('registers selector sub-resources', () => {
    const store = createMockStore({ count: 5, name: 'Alice' });

    const stores: StoreAdapter[] = [
      {
        name: 'app',
        getState: store.getState,
        subscribe: store.subscribe,
        selectors: {
          count: (state: unknown) => (state as { count: number }).count,
          name: (state: unknown) => (state as { name: string }).name,
        },
      },
    ];

    renderHook(() => useStoreRegistration(stores, dynamicRegistry));

    expect(dynamicRegistry.hasResource('state://app/count')).toBe(true);
    expect(dynamicRegistry.hasResource('state://app/name')).toBe(true);

    const countRes = dynamicRegistry.findResource('state://app/count');
    expect(countRes!.name).toBe('app-count');
    expect(countRes!.description).toBe('Selector "count" from app store');

    const nameRes = dynamicRegistry.findResource('state://app/name');
    expect(nameRes!.name).toBe('app-name');
    expect(nameRes!.description).toBe('Selector "name" from app store');
  });

  it('selector reads return selected values', async () => {
    const store = createMockStore({ count: 42, items: ['a', 'b'] });

    const stores: StoreAdapter[] = [
      {
        name: 'shop',
        getState: store.getState,
        subscribe: store.subscribe,
        selectors: {
          count: (state: unknown) => (state as { count: number }).count,
          items: (state: unknown) => (state as { items: string[] }).items,
        },
      },
    ];

    renderHook(() => useStoreRegistration(stores, dynamicRegistry));

    const countRes = dynamicRegistry.findResource('state://shop/count')!;
    const countResult = await countRes.read();
    expect(countResult.contents).toEqual([{ uri: 'state://shop/count', mimeType: 'application/json', text: '42' }]);

    const itemsRes = dynamicRegistry.findResource('state://shop/items')!;
    const itemsResult = await itemsRes.read();
    expect(itemsResult.contents).toEqual([
      { uri: 'state://shop/items', mimeType: 'application/json', text: JSON.stringify(['a', 'b']) },
    ]);
  });

  it('registers action tools', () => {
    const store = createMockStore({ count: 0 });
    const increment = jest.fn();
    const reset = jest.fn();

    const stores: StoreAdapter[] = [
      {
        name: 'counter',
        getState: store.getState,
        subscribe: store.subscribe,
        actions: { increment, reset },
      },
    ];

    renderHook(() => useStoreRegistration(stores, dynamicRegistry));

    expect(dynamicRegistry.hasTool('counter_increment')).toBe(true);
    expect(dynamicRegistry.hasTool('counter_reset')).toBe(true);

    const incTool = dynamicRegistry.findTool('counter_increment');
    expect(incTool!.description).toBe('Action "increment" on counter store');
    expect(incTool!.inputSchema).toEqual({
      type: 'object',
      properties: {
        args: { type: 'array', description: 'Arguments to pass to the action' },
      },
    });
  });

  it('action tool execution calls the action', async () => {
    const store = createMockStore({ count: 0 });
    const add = jest.fn((...args: unknown[]) => args[0]);

    const stores: StoreAdapter[] = [
      {
        name: 'math',
        getState: store.getState,
        subscribe: store.subscribe,
        actions: { add },
      },
    ];

    renderHook(() => useStoreRegistration(stores, dynamicRegistry));

    const tool = dynamicRegistry.findTool('math_add')!;

    let result: unknown;
    await act(async () => {
      result = await tool.execute({ args: [5, 10] });
    });

    expect(add).toHaveBeenCalledWith(5, 10);
    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ success: true, result: 5 }) }],
    });
  });

  it('action tool calls action with args object when args is not an array', async () => {
    const store = createMockStore({ count: 0 });
    const setName = jest.fn((args: unknown) => args);

    const stores: StoreAdapter[] = [
      {
        name: 'store',
        getState: store.getState,
        subscribe: store.subscribe,
        actions: { setName },
      },
    ];

    renderHook(() => useStoreRegistration(stores, dynamicRegistry));

    const tool = dynamicRegistry.findTool('store_setName')!;

    await act(async () => {
      await tool.execute({ name: 'Alice', age: 30 });
    });

    expect(setName).toHaveBeenCalledWith({ name: 'Alice', age: 30 });
  });

  it('does nothing when stores array is empty', () => {
    renderHook(() => useStoreRegistration([], dynamicRegistry));

    expect(dynamicRegistry.getTools().length).toBe(0);
    expect(dynamicRegistry.getResources().length).toBe(0);
  });

  it('subscribes to store changes and calls updateResourceRead', () => {
    const store = createMockStore({ value: 'initial' });
    const updateSpy = jest.spyOn(dynamicRegistry, 'updateResourceRead');

    const stores: StoreAdapter[] = [{ name: 'observed', getState: store.getState, subscribe: store.subscribe }];

    renderHook(() => useStoreRegistration(stores, dynamicRegistry));

    act(() => {
      store.setState({ value: 'updated' });
    });

    expect(updateSpy).toHaveBeenCalledWith('state://observed', expect.any(Function));
  });

  it('calls updateResourceRead for selector URIs when store changes', () => {
    const store = createMockStore({ count: 0, label: 'test' });
    const updateSpy = jest.spyOn(dynamicRegistry, 'updateResourceRead');

    const stores: StoreAdapter[] = [
      {
        name: 'sel',
        getState: store.getState,
        subscribe: store.subscribe,
        selectors: {
          count: (state: unknown) => (state as { count: number }).count,
          label: (state: unknown) => (state as { label: string }).label,
        },
      },
    ];

    renderHook(() => useStoreRegistration(stores, dynamicRegistry));

    updateSpy.mockClear();

    act(() => {
      store.setState({ count: 5 });
    });

    // Main resource + 2 selectors
    expect(updateSpy).toHaveBeenCalledWith('state://sel', expect.any(Function));
    expect(updateSpy).toHaveBeenCalledWith('state://sel/count', expect.any(Function));
    expect(updateSpy).toHaveBeenCalledWith('state://sel/label', expect.any(Function));
  });

  it('unregisters everything on unmount', () => {
    const store = createMockStore({ count: 0 });

    const stores: StoreAdapter[] = [
      {
        name: 'app',
        getState: store.getState,
        subscribe: store.subscribe,
        selectors: {
          doubled: (state: unknown) => (state as { count: number }).count * 2,
        },
        actions: {
          increment: jest.fn(),
        },
      },
    ];

    const { unmount } = renderHook(() => useStoreRegistration(stores, dynamicRegistry));

    expect(dynamicRegistry.hasResource('state://app')).toBe(true);
    expect(dynamicRegistry.hasResource('state://app/doubled')).toBe(true);
    expect(dynamicRegistry.hasTool('app_increment')).toBe(true);

    unmount();

    expect(dynamicRegistry.hasResource('state://app')).toBe(false);
    expect(dynamicRegistry.hasResource('state://app/doubled')).toBe(false);
    expect(dynamicRegistry.hasTool('app_increment')).toBe(false);
  });
});
