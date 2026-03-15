import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { useValtioResource } from '../useValtioResource';
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

/**
 * Minimal mock that simulates valtio's subscribe(proxy, callback) signature.
 * Returns an unsubscribe function.
 */
function createMockValtioSubscribe() {
  const listeners = new Set<() => void>();

  const subscribe = jest.fn((_proxy: Record<string, unknown>, cb: () => void): (() => void) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  });

  // Helper to trigger all listeners (simulates proxy mutation)
  const notify = () =>
    listeners.forEach((l) => {
      l();
    });

  return { subscribe, notify };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useValtioResource', () => {
  let dynamicRegistry: DynamicRegistry;

  beforeEach(() => {
    dynamicRegistry = new DynamicRegistry();
  });

  describe('main state resource', () => {
    it('registers main state resource on mount', () => {
      const proxy = { count: 0, name: 'Alice' };
      const { subscribe } = createMockValtioSubscribe();

      renderHook(() => useValtioResource({ proxy, subscribe }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      expect(dynamicRegistry.hasResource('state://valtio')).toBe(true);
      const resource = dynamicRegistry.findResource('state://valtio');
      expect(resource).toBeDefined();
      expect(resource!.name).toBe('valtio-state');
      expect(resource!.description).toBe('Full state of valtio store');
    });

    it('defaults name to "valtio"', () => {
      const proxy = { count: 0 };
      const { subscribe } = createMockValtioSubscribe();

      renderHook(() => useValtioResource({ proxy, subscribe }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      expect(dynamicRegistry.hasResource('state://valtio')).toBe(true);
    });

    it('uses custom name', () => {
      const proxy = { count: 0 };
      const { subscribe } = createMockValtioSubscribe();

      renderHook(() => useValtioResource({ proxy, subscribe, name: 'my-store' }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      expect(dynamicRegistry.hasResource('state://my-store')).toBe(true);
      expect(dynamicRegistry.hasResource('state://valtio')).toBe(false);
    });

    it('snapshots proxy for reads (deep copy, not reference)', async () => {
      const proxy = { count: 0, nested: { value: 'hello' } };
      const { subscribe } = createMockValtioSubscribe();

      renderHook(() => useValtioResource({ proxy, subscribe }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      const resource = dynamicRegistry.findResource('state://valtio')!;
      const result = await resource.read();
      const parsed = JSON.parse(result.contents[0].text as string);

      expect(parsed).toEqual({ count: 0, nested: { value: 'hello' } });

      // Mutate the proxy — a previously-read snapshot should NOT change
      // (since getState does JSON.parse(JSON.stringify(proxy)))
      proxy.count = 999;
      expect(parsed.count).toBe(0);
    });

    it('resource read reflects proxy mutations after re-read', async () => {
      const proxy = { count: 0 };
      const { subscribe } = createMockValtioSubscribe();

      renderHook(() => useValtioResource({ proxy, subscribe }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      // Mutate
      proxy.count = 42;

      const resource = dynamicRegistry.findResource('state://valtio')!;
      const result = await resource.read();
      const parsed = JSON.parse(result.contents[0].text as string);
      expect(parsed.count).toBe(42);
    });
  });

  describe('valtio subscribe wrapping', () => {
    it('wraps valtio subscribe correctly by passing proxy as first arg', () => {
      const proxy = { count: 0 };
      const { subscribe } = createMockValtioSubscribe();

      renderHook(() => useValtioResource({ proxy, subscribe }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      // subscribe should have been called with (proxy, callback)
      expect(subscribe).toHaveBeenCalledTimes(1);
      expect(subscribe).toHaveBeenCalledWith(proxy, expect.any(Function));
    });

    it('triggers updateResourceRead when valtio subscription fires', () => {
      const proxy = { count: 0 };
      const { subscribe, notify } = createMockValtioSubscribe();
      const updateSpy = jest.spyOn(dynamicRegistry, 'updateResourceRead');

      renderHook(() => useValtioResource({ proxy, subscribe }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      act(() => {
        notify();
      });

      expect(updateSpy).toHaveBeenCalledWith('state://valtio', expect.any(Function));
    });
  });

  describe('unregistration on unmount', () => {
    it('unregisters main state resource on unmount', () => {
      const proxy = { count: 0 };
      const { subscribe } = createMockValtioSubscribe();

      const { unmount } = renderHook(() => useValtioResource({ proxy, subscribe }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      expect(dynamicRegistry.hasResource('state://valtio')).toBe(true);
      unmount();
      expect(dynamicRegistry.hasResource('state://valtio')).toBe(false);
    });

    it('unregisters path-based selector resources on unmount', () => {
      const proxy = { user: { name: 'Alice', age: 30 } };
      const { subscribe } = createMockValtioSubscribe();

      const { unmount } = renderHook(
        () =>
          useValtioResource({
            proxy,
            subscribe,
            paths: { userName: 'user.name' },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      expect(dynamicRegistry.hasResource('state://valtio/userName')).toBe(true);
      unmount();
      expect(dynamicRegistry.hasResource('state://valtio/userName')).toBe(false);
    });

    it('unregisters mutation tools on unmount', () => {
      const proxy = { count: 0 };
      const { subscribe } = createMockValtioSubscribe();

      const { unmount } = renderHook(
        () =>
          useValtioResource({
            proxy,
            subscribe,
            mutations: { increment: () => {} },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      expect(dynamicRegistry.hasTool('valtio_increment')).toBe(true);
      unmount();
      expect(dynamicRegistry.hasTool('valtio_increment')).toBe(false);
    });
  });

  describe('paths (dot-notation selectors)', () => {
    it('registers selector sub-resources from paths', () => {
      const proxy = { user: { name: 'Alice', profile: { email: 'a@b.c' } } };
      const { subscribe } = createMockValtioSubscribe();

      renderHook(
        () =>
          useValtioResource({
            proxy,
            subscribe,
            paths: {
              name: 'user.name',
              email: 'user.profile.email',
            },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      expect(dynamicRegistry.hasResource('state://valtio/name')).toBe(true);
      expect(dynamicRegistry.hasResource('state://valtio/email')).toBe(true);
    });

    it('getByPath resolves nested values correctly', async () => {
      const proxy = { a: { b: { c: 'deep-value' } } };
      const { subscribe } = createMockValtioSubscribe();

      renderHook(
        () =>
          useValtioResource({
            proxy,
            subscribe,
            paths: { deep: 'a.b.c' },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      const resource = dynamicRegistry.findResource('state://valtio/deep')!;
      const result = await resource.read();
      expect((result.contents[0] as { text: string }).text).toBe('"deep-value"');
    });

    it('getByPath returns undefined for non-existent paths', async () => {
      const proxy = { a: { b: 1 } };
      const { subscribe } = createMockValtioSubscribe();

      renderHook(
        () =>
          useValtioResource({
            proxy,
            subscribe,
            paths: { missing: 'a.x.y' },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      const resource = dynamicRegistry.findResource('state://valtio/missing')!;
      const result = await resource.read();
      // undefined coalesces to null for valid JSON serialization
      expect((result.contents[0] as { text: string }).text).toBe('null');
    });

    it('getByPath returns undefined when traversing through a primitive', async () => {
      const proxy = { count: 42 };
      const { subscribe } = createMockValtioSubscribe();

      renderHook(
        () =>
          useValtioResource({
            proxy,
            subscribe,
            paths: { bad: 'count.nested' },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      const resource = dynamicRegistry.findResource('state://valtio/bad')!;
      const result = await resource.read();
      expect((result.contents[0] as { text: string }).text).toBe('null');
    });

    it('getByPath returns undefined when state is null', async () => {
      // Proxy object where a key is null
      const proxy = { data: null } as Record<string, unknown>;
      const { subscribe } = createMockValtioSubscribe();

      renderHook(
        () =>
          useValtioResource({
            proxy,
            subscribe,
            paths: { value: 'data.nested' },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      const resource = dynamicRegistry.findResource('state://valtio/value')!;
      const result = await resource.read();
      expect((result.contents[0] as { text: string }).text).toBe('null');
    });

    it('does not register selectors when paths not provided', () => {
      const proxy = { count: 0 };
      const { subscribe } = createMockValtioSubscribe();

      renderHook(() => useValtioResource({ proxy, subscribe }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      // Only main resource
      expect(dynamicRegistry.getResources()).toHaveLength(1);
    });
  });

  describe('mutations (actions)', () => {
    it('registers mutation tools', () => {
      const proxy = { count: 0 };
      const { subscribe } = createMockValtioSubscribe();
      const increment = jest.fn();
      const reset = jest.fn();

      renderHook(
        () =>
          useValtioResource({
            proxy,
            subscribe,
            mutations: { increment, reset },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      expect(dynamicRegistry.hasTool('valtio_increment')).toBe(true);
      expect(dynamicRegistry.hasTool('valtio_reset')).toBe(true);
    });

    it('wraps mutations as actions that call the mutation function', async () => {
      const proxy = { count: 0 };
      const { subscribe } = createMockValtioSubscribe();
      const increment = jest.fn();

      renderHook(
        () =>
          useValtioResource({
            proxy,
            subscribe,
            mutations: { increment },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      const tool = dynamicRegistry.findTool('valtio_increment')!;

      await act(async () => {
        await tool.execute({ args: [5] });
      });

      expect(increment).toHaveBeenCalledWith(5);
    });

    it('passes multiple arguments to mutation', async () => {
      const proxy = { items: [] as string[] };
      const { subscribe } = createMockValtioSubscribe();
      const addItem = jest.fn();

      renderHook(
        () =>
          useValtioResource({
            proxy,
            subscribe,
            mutations: { addItem },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      const tool = dynamicRegistry.findTool('valtio_addItem')!;

      await act(async () => {
        await tool.execute({ args: ['item1', 'item2'] });
      });

      expect(addItem).toHaveBeenCalledWith('item1', 'item2');
    });

    it('does not register tools when mutations not provided', () => {
      const proxy = { count: 0 };
      const { subscribe } = createMockValtioSubscribe();

      renderHook(() => useValtioResource({ proxy, subscribe }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      expect(dynamicRegistry.getTools()).toHaveLength(0);
    });
  });

  describe('server option', () => {
    it('passes server option through without error', () => {
      const proxy = { count: 0 };
      const { subscribe } = createMockValtioSubscribe();

      renderHook(() => useValtioResource({ proxy, subscribe, server: 'my-server' }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      expect(dynamicRegistry.hasResource('state://valtio')).toBe(true);
    });
  });

  describe('full integration', () => {
    it('registers resources, selectors, and mutations together, cleans up on unmount', () => {
      const proxy = { user: { name: 'Alice' }, count: 0 };
      const { subscribe } = createMockValtioSubscribe();

      const { unmount } = renderHook(
        () =>
          useValtioResource({
            proxy,
            subscribe,
            name: 'app',
            paths: { userName: 'user.name' },
            mutations: { increment: jest.fn() },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      expect(dynamicRegistry.hasResource('state://app')).toBe(true);
      expect(dynamicRegistry.hasResource('state://app/userName')).toBe(true);
      expect(dynamicRegistry.hasTool('app_increment')).toBe(true);

      unmount();

      expect(dynamicRegistry.hasResource('state://app')).toBe(false);
      expect(dynamicRegistry.hasResource('state://app/userName')).toBe(false);
      expect(dynamicRegistry.hasTool('app_increment')).toBe(false);
    });

    it('selector reads reflect proxy mutations', async () => {
      const proxy = { user: { name: 'Alice' } };
      const { subscribe } = createMockValtioSubscribe();

      renderHook(
        () =>
          useValtioResource({
            proxy,
            subscribe,
            paths: { name: 'user.name' },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      // Mutate the proxy
      proxy.user.name = 'Bob';

      const resource = dynamicRegistry.findResource('state://valtio/name')!;
      const result = await resource.read();
      expect((result.contents[0] as { text: string }).text).toBe('"Bob"');
    });
  });
});
