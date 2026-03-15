import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { useStoreResource } from '../useStoreResource';
import { FrontMcpContext } from '../../provider/FrontMcpContext';
import { DynamicRegistry } from '../../registry/DynamicRegistry';
import { ComponentRegistry } from '../../components/ComponentRegistry';
import type { FrontMcpContextValue } from '../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper(dynamicRegistry: DynamicRegistry) {
  const ctx: FrontMcpContextValue = {
    name: 'test',
    registry: new ComponentRegistry(),
    dynamicRegistry,
    getDynamicRegistry: () => dynamicRegistry,
    connect: async () => {},
  };
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(FrontMcpContext.Provider, { value: ctx }, children);
  };
}

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

describe('useStoreResource (state module)', () => {
  let dynamicRegistry: DynamicRegistry;

  beforeEach(() => {
    dynamicRegistry = new DynamicRegistry();
  });

  describe('main state resource', () => {
    it('registers main state resource on mount', () => {
      const store = createMockStore({ count: 0 });

      renderHook(
        () =>
          useStoreResource({
            name: 'counter',
            getState: store.getState,
            subscribe: store.subscribe,
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      expect(dynamicRegistry.hasResource('state://counter')).toBe(true);
      const resource = dynamicRegistry.findResource('state://counter');
      expect(resource).toBeDefined();
      expect(resource!.name).toBe('counter-state');
      expect(resource!.description).toBe('Full state of counter store');
      expect(resource!.mimeType).toBe('application/json');
    });

    it('resource read returns current state as JSON', async () => {
      const store = createMockStore({ count: 42, label: 'test' });

      renderHook(
        () =>
          useStoreResource({
            name: 'mystore',
            getState: store.getState,
            subscribe: store.subscribe,
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      const resource = dynamicRegistry.findResource('state://mystore')!;
      const result = await resource.read();

      expect(result.contents).toEqual([
        {
          uri: 'state://mystore',
          mimeType: 'application/json',
          text: JSON.stringify({ count: 42, label: 'test' }),
        },
      ]);
    });

    it('resource read reflects latest state after store mutation', async () => {
      const store = createMockStore({ count: 0 });

      renderHook(
        () =>
          useStoreResource({
            name: 'counter',
            getState: store.getState,
            subscribe: store.subscribe,
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      // Mutate state
      act(() => {
        store.setState({ count: 10 });
      });

      const resource = dynamicRegistry.findResource('state://counter')!;
      const result = await resource.read();

      expect(result.contents[0].text).toBe(JSON.stringify({ count: 10 }));
    });

    it('unregisters main state resource on unmount', () => {
      const store = createMockStore({ count: 0 });

      const { unmount } = renderHook(
        () =>
          useStoreResource({
            name: 'counter',
            getState: store.getState,
            subscribe: store.subscribe,
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      expect(dynamicRegistry.hasResource('state://counter')).toBe(true);

      unmount();

      expect(dynamicRegistry.hasResource('state://counter')).toBe(false);
    });
  });

  describe('store subscription', () => {
    it('subscribes to store changes on mount', () => {
      const subscribeSpy = jest.fn(() => jest.fn());

      renderHook(
        () =>
          useStoreResource({
            name: 'subtest',
            getState: () => ({}),
            subscribe: subscribeSpy,
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      expect(subscribeSpy).toHaveBeenCalledTimes(1);
      expect(subscribeSpy).toHaveBeenCalledWith(expect.any(Function));
    });

    it('calls unsubscribe on unmount', () => {
      const unsubscribe = jest.fn();
      const subscribe = jest.fn(() => unsubscribe);

      const { unmount } = renderHook(
        () =>
          useStoreResource({
            name: 'subtest',
            getState: () => ({}),
            subscribe,
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      unmount();

      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('calls updateResourceRead when store changes', () => {
      const store = createMockStore({ value: 'initial' });
      const updateSpy = jest.spyOn(dynamicRegistry, 'updateResourceRead');

      renderHook(
        () =>
          useStoreResource({
            name: 'observed',
            getState: store.getState,
            subscribe: store.subscribe,
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      const versionBefore = dynamicRegistry.getVersion();

      act(() => {
        store.setState({ value: 'updated' });
      });

      expect(updateSpy).toHaveBeenCalledWith('state://observed', expect.any(Function));
      expect(dynamicRegistry.getVersion()).toBeGreaterThan(versionBefore);
    });

    it('calls updateResourceRead for selector URIs when store changes', () => {
      const store = createMockStore({ count: 0, label: 'test' });
      const updateSpy = jest.spyOn(dynamicRegistry, 'updateResourceRead');

      renderHook(
        () =>
          useStoreResource({
            name: 'sel',
            getState: store.getState,
            subscribe: store.subscribe,
            selectors: {
              count: (state: unknown) => (state as { count: number }).count,
              label: (state: unknown) => (state as { label: string }).label,
            },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      updateSpy.mockClear();
      const versionBefore = dynamicRegistry.getVersion();

      act(() => {
        store.setState({ count: 5 });
      });

      // Main resource + 2 selectors
      expect(updateSpy).toHaveBeenCalledWith('state://sel', expect.any(Function));
      expect(updateSpy).toHaveBeenCalledWith('state://sel/count', expect.any(Function));
      expect(updateSpy).toHaveBeenCalledWith('state://sel/label', expect.any(Function));
      expect(dynamicRegistry.getVersion()).toBeGreaterThan(versionBefore);
    });
  });

  describe('selector sub-resources', () => {
    it('registers selector sub-resources', () => {
      const store = createMockStore({ count: 5, name: 'Alice' });

      renderHook(
        () =>
          useStoreResource({
            name: 'app',
            getState: store.getState,
            subscribe: store.subscribe,
            selectors: {
              count: (state: unknown) => (state as { count: number }).count,
              name: (state: unknown) => (state as { name: string }).name,
            },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      expect(dynamicRegistry.hasResource('state://app/count')).toBe(true);
      expect(dynamicRegistry.hasResource('state://app/name')).toBe(true);

      const countResource = dynamicRegistry.findResource('state://app/count');
      expect(countResource!.name).toBe('app-count');
      expect(countResource!.description).toBe('Selector "count" from app store');

      const nameResource = dynamicRegistry.findResource('state://app/name');
      expect(nameResource!.name).toBe('app-name');
      expect(nameResource!.description).toBe('Selector "name" from app store');
    });

    it('selector reads return selected values', async () => {
      const store = createMockStore({ count: 42, items: ['a', 'b', 'c'] });

      renderHook(
        () =>
          useStoreResource({
            name: 'shop',
            getState: store.getState,
            subscribe: store.subscribe,
            selectors: {
              count: (state: unknown) => (state as { count: number }).count,
              items: (state: unknown) => (state as { items: string[] }).items,
            },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      const countResource = dynamicRegistry.findResource('state://shop/count')!;
      const countResult = await countResource.read();
      expect(countResult.contents).toEqual([{ uri: 'state://shop/count', mimeType: 'application/json', text: '42' }]);

      const itemsResource = dynamicRegistry.findResource('state://shop/items')!;
      const itemsResult = await itemsResource.read();
      expect(itemsResult.contents).toEqual([
        { uri: 'state://shop/items', mimeType: 'application/json', text: JSON.stringify(['a', 'b', 'c']) },
      ]);
    });

    it('selector reads reflect latest state', async () => {
      const store = createMockStore({ count: 0 });

      renderHook(
        () =>
          useStoreResource({
            name: 'counter',
            getState: store.getState,
            subscribe: store.subscribe,
            selectors: {
              doubled: (state: unknown) => (state as { count: number }).count * 2,
            },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      act(() => {
        store.setState({ count: 21 });
      });

      const resource = dynamicRegistry.findResource('state://counter/doubled')!;
      const result = await resource.read();
      expect(result.contents[0].text).toBe('42');
    });

    it('unregisters selector sub-resources on unmount', () => {
      const store = createMockStore({ a: 1, b: 2 });

      const { unmount } = renderHook(
        () =>
          useStoreResource({
            name: 'data',
            getState: store.getState,
            subscribe: store.subscribe,
            selectors: {
              a: (state: unknown) => (state as { a: number }).a,
              b: (state: unknown) => (state as { b: number }).b,
            },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      expect(dynamicRegistry.hasResource('state://data/a')).toBe(true);
      expect(dynamicRegistry.hasResource('state://data/b')).toBe(true);

      unmount();

      expect(dynamicRegistry.hasResource('state://data/a')).toBe(false);
      expect(dynamicRegistry.hasResource('state://data/b')).toBe(false);
    });

    it('does not register selectors when none provided', () => {
      const store = createMockStore({ count: 0 });

      renderHook(
        () =>
          useStoreResource({
            name: 'no-selectors',
            getState: store.getState,
            subscribe: store.subscribe,
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      // Only main resource should exist
      expect(dynamicRegistry.hasResource('state://no-selectors')).toBe(true);
      expect(dynamicRegistry.getResources().length).toBe(1);
    });
  });

  describe('action tools', () => {
    it('registers action tools', () => {
      const store = createMockStore({ count: 0 });
      const increment = jest.fn();
      const reset = jest.fn();

      renderHook(
        () =>
          useStoreResource({
            name: 'counter',
            getState: store.getState,
            subscribe: store.subscribe,
            actions: { increment, reset },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

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

    it('action tool execution calls the action with args array', async () => {
      const store = createMockStore({ count: 0 });
      const add = jest.fn((...args: unknown[]) => args[0]);

      renderHook(
        () =>
          useStoreResource({
            name: 'math',
            getState: store.getState,
            subscribe: store.subscribe,
            actions: { add },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

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

    it('action tool execution calls action with args object when args is not an array', async () => {
      const store = createMockStore({ count: 0 });
      const setName = jest.fn((args: unknown) => args);

      renderHook(
        () =>
          useStoreResource({
            name: 'store',
            getState: store.getState,
            subscribe: store.subscribe,
            actions: { setName },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      const tool = dynamicRegistry.findTool('store_setName')!;

      await act(async () => {
        await tool.execute({ name: 'Alice', age: 30 });
      });

      // When args key is not present as an array, the full args object is passed
      expect(setName).toHaveBeenCalledWith({ name: 'Alice', age: 30 });
    });

    it('action tool returns result in response', async () => {
      const store = createMockStore({});
      const compute = jest.fn(() => 42);

      renderHook(
        () =>
          useStoreResource({
            name: 'calc',
            getState: store.getState,
            subscribe: store.subscribe,
            actions: { compute },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      const tool = dynamicRegistry.findTool('calc_compute')!;

      let result: unknown;
      await act(async () => {
        result = await tool.execute({ args: [] });
      });

      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.result).toBe(42);
    });

    it('unregisters action tools on unmount', () => {
      const store = createMockStore({ count: 0 });

      const { unmount } = renderHook(
        () =>
          useStoreResource({
            name: 'counter',
            getState: store.getState,
            subscribe: store.subscribe,
            actions: {
              increment: jest.fn(),
              decrement: jest.fn(),
            },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      expect(dynamicRegistry.hasTool('counter_increment')).toBe(true);
      expect(dynamicRegistry.hasTool('counter_decrement')).toBe(true);

      unmount();

      expect(dynamicRegistry.hasTool('counter_increment')).toBe(false);
      expect(dynamicRegistry.hasTool('counter_decrement')).toBe(false);
    });

    it('does not register actions when none provided', () => {
      const store = createMockStore({ count: 0 });

      renderHook(
        () =>
          useStoreResource({
            name: 'no-actions',
            getState: store.getState,
            subscribe: store.subscribe,
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      expect(dynamicRegistry.getTools().length).toBe(0);
    });
  });

  describe('full integration', () => {
    it('registers resources and tools together, cleans up on unmount', () => {
      const store = createMockStore({ count: 0, items: [] });

      const { unmount } = renderHook(
        () =>
          useStoreResource({
            name: 'app',
            getState: store.getState,
            subscribe: store.subscribe,
            selectors: {
              count: (state: unknown) => (state as { count: number }).count,
            },
            actions: {
              increment: jest.fn(),
            },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      // Verify everything is registered
      expect(dynamicRegistry.hasResource('state://app')).toBe(true);
      expect(dynamicRegistry.hasResource('state://app/count')).toBe(true);
      expect(dynamicRegistry.hasTool('app_increment')).toBe(true);

      unmount();

      // Verify everything is cleaned up
      expect(dynamicRegistry.hasResource('state://app')).toBe(false);
      expect(dynamicRegistry.hasResource('state://app/count')).toBe(false);
      expect(dynamicRegistry.hasTool('app_increment')).toBe(false);
    });

    it('state and selectors reflect mutations through getState ref', async () => {
      const store = createMockStore({ count: 0 });

      renderHook(
        () =>
          useStoreResource({
            name: 'counter',
            getState: store.getState,
            subscribe: store.subscribe,
            selectors: {
              doubled: (state: unknown) => (state as { count: number }).count * 2,
            },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      // Mutate state directly (simulating external store update)
      act(() => {
        store.setState({ count: 7 });
      });

      const mainResource = dynamicRegistry.findResource('state://counter')!;
      const mainResult = await mainResource.read();
      expect(JSON.parse(mainResult.contents[0].text)).toEqual({ count: 7 });

      const selectorResource = dynamicRegistry.findResource('state://counter/doubled')!;
      const selectorResult = await selectorResource.read();
      expect(JSON.parse(selectorResult.contents[0].text)).toBe(14);
    });
  });
});
