import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { useReduxResource } from '../useReduxResource';
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

function createMockReduxStore(initialState: Record<string, unknown>) {
  let state = { ...initialState };
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    dispatch: jest.fn((action: unknown) => action),
    subscribe: (cb: () => void): (() => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    // Test helper to mutate state and notify listeners
    _setState: (next: Record<string, unknown>) => {
      state = { ...state, ...next };
      listeners.forEach((l) => {
        l();
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useReduxResource', () => {
  let dynamicRegistry: DynamicRegistry;

  beforeEach(() => {
    dynamicRegistry = new DynamicRegistry();
  });

  describe('main state resource', () => {
    it('registers main state resource on mount', () => {
      const store = createMockReduxStore({ count: 0 });

      renderHook(() => useReduxResource({ store }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      expect(dynamicRegistry.hasResource('state://redux')).toBe(true);
      const resource = dynamicRegistry.findResource('state://redux');
      expect(resource).toBeDefined();
      expect(resource!.name).toBe('redux-state');
      expect(resource!.description).toBe('Full state of redux store');
    });

    it('defaults name to "redux"', () => {
      const store = createMockReduxStore({ count: 0 });

      renderHook(() => useReduxResource({ store }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      expect(dynamicRegistry.hasResource('state://redux')).toBe(true);
    });

    it('uses custom name for state resource', () => {
      const store = createMockReduxStore({ count: 0 });

      renderHook(() => useReduxResource({ store, name: 'app-state' }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      expect(dynamicRegistry.hasResource('state://app-state')).toBe(true);
      expect(dynamicRegistry.hasResource('state://redux')).toBe(false);
    });

    it('resource read returns current state as JSON', async () => {
      const store = createMockReduxStore({ count: 42, label: 'test' });

      renderHook(() => useReduxResource({ store }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      const resource = dynamicRegistry.findResource('state://redux')!;
      const result = await resource.read();

      expect(result.contents).toEqual([
        {
          uri: 'state://redux',
          mimeType: 'application/json',
          text: JSON.stringify({ count: 42, label: 'test' }),
        },
      ]);
    });

    it('resource read reflects state changes', async () => {
      const store = createMockReduxStore({ count: 0 });

      renderHook(() => useReduxResource({ store }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      act(() => {
        store._setState({ count: 99 });
      });

      const resource = dynamicRegistry.findResource('state://redux')!;
      const result = await resource.read();
      expect(JSON.parse(result.contents[0].text as string)).toEqual({ count: 99 });
    });
  });

  describe('unregistration on unmount', () => {
    it('unregisters main state resource on unmount', () => {
      const store = createMockReduxStore({ count: 0 });

      const { unmount } = renderHook(() => useReduxResource({ store }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      expect(dynamicRegistry.hasResource('state://redux')).toBe(true);
      unmount();
      expect(dynamicRegistry.hasResource('state://redux')).toBe(false);
    });

    it('unregisters selector sub-resources on unmount', () => {
      const store = createMockReduxStore({ count: 0, name: 'Alice' });

      const { unmount } = renderHook(
        () =>
          useReduxResource({
            store,
            selectors: {
              count: (s: unknown) => (s as { count: number }).count,
            },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      expect(dynamicRegistry.hasResource('state://redux/count')).toBe(true);
      unmount();
      expect(dynamicRegistry.hasResource('state://redux/count')).toBe(false);
    });

    it('unregisters action tools on unmount', () => {
      const store = createMockReduxStore({ count: 0 });

      const { unmount } = renderHook(
        () =>
          useReduxResource({
            store,
            actions: { increment: () => ({ type: 'INC' }) },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      expect(dynamicRegistry.hasTool('redux_increment')).toBe(true);
      unmount();
      expect(dynamicRegistry.hasTool('redux_increment')).toBe(false);
    });
  });

  describe('selectors', () => {
    it('registers selector sub-resources', () => {
      const store = createMockReduxStore({ count: 5, name: 'Alice' });

      renderHook(
        () =>
          useReduxResource({
            store,
            selectors: {
              count: (s: unknown) => (s as { count: number }).count,
              name: (s: unknown) => (s as { name: string }).name,
            },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      expect(dynamicRegistry.hasResource('state://redux/count')).toBe(true);
      expect(dynamicRegistry.hasResource('state://redux/name')).toBe(true);
    });

    it('selector reads return selected values', async () => {
      const store = createMockReduxStore({ count: 42 });

      renderHook(
        () =>
          useReduxResource({
            store,
            selectors: {
              count: (s: unknown) => (s as { count: number }).count,
            },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      const resource = dynamicRegistry.findResource('state://redux/count')!;
      const result = await resource.read();
      expect(result.contents[0].text).toBe('42');
    });
  });

  describe('actions with auto-dispatch', () => {
    it('registers action tools', () => {
      const store = createMockReduxStore({ count: 0 });
      const increment = () => ({ type: 'INCREMENT' });
      const reset = () => ({ type: 'RESET' });

      renderHook(
        () =>
          useReduxResource({
            store,
            actions: { increment, reset },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      expect(dynamicRegistry.hasTool('redux_increment')).toBe(true);
      expect(dynamicRegistry.hasTool('redux_reset')).toBe(true);
    });

    it('wraps action creators to auto-dispatch', async () => {
      const store = createMockReduxStore({ count: 0 });
      const increment = jest.fn(() => ({ type: 'INCREMENT' }));

      renderHook(
        () =>
          useReduxResource({
            store,
            actions: { increment },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      const tool = dynamicRegistry.findTool('redux_increment')!;

      await act(async () => {
        await tool.execute({ args: [] });
      });

      expect(increment).toHaveBeenCalledTimes(1);
      expect(store.dispatch).toHaveBeenCalledWith({ type: 'INCREMENT' });
    });

    it('passes arguments through to the action creator', async () => {
      const store = createMockReduxStore({ count: 0 });
      const addAmount = jest.fn((amount: unknown) => ({ type: 'ADD', payload: amount }));

      renderHook(
        () =>
          useReduxResource({
            store,
            actions: { addAmount },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      const tool = dynamicRegistry.findTool('redux_addAmount')!;

      await act(async () => {
        await tool.execute({ args: [10] });
      });

      expect(addAmount).toHaveBeenCalledWith(10);
      expect(store.dispatch).toHaveBeenCalledWith({ type: 'ADD', payload: 10 });
    });

    it('returns dispatch result in the tool response', async () => {
      const store = createMockReduxStore({ count: 0 });
      store.dispatch.mockReturnValue({ type: 'INC' });
      const increment = () => ({ type: 'INC' });

      renderHook(
        () =>
          useReduxResource({
            store,
            actions: { increment },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      const tool = dynamicRegistry.findTool('redux_increment')!;

      let result: unknown;
      await act(async () => {
        result = await tool.execute({ args: [] });
      });

      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.result).toEqual({ type: 'INC' });
    });
  });

  describe('no actions or selectors', () => {
    it('does not register action tools when actions not provided', () => {
      const store = createMockReduxStore({ count: 0 });

      renderHook(() => useReduxResource({ store }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      expect(dynamicRegistry.getTools()).toHaveLength(0);
    });

    it('does not register selector sub-resources when selectors not provided', () => {
      const store = createMockReduxStore({ count: 0 });

      renderHook(() => useReduxResource({ store }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      // Only main resource
      expect(dynamicRegistry.getResources()).toHaveLength(1);
    });
  });

  describe('server option', () => {
    it('passes server option through without error', () => {
      const store = createMockReduxStore({ count: 0 });

      renderHook(() => useReduxResource({ store, server: 'my-server' }), {
        wrapper: createWrapper(dynamicRegistry),
      });

      expect(dynamicRegistry.hasResource('state://redux')).toBe(true);
    });
  });

  describe('full integration', () => {
    it('registers resources and tools together, cleans up on unmount', () => {
      const store = createMockReduxStore({ count: 0 });
      const increment = () => ({ type: 'INC' });

      const { unmount } = renderHook(
        () =>
          useReduxResource({
            store,
            name: 'app',
            selectors: {
              count: (s: unknown) => (s as { count: number }).count,
            },
            actions: { increment },
          }),
        { wrapper: createWrapper(dynamicRegistry) },
      );

      expect(dynamicRegistry.hasResource('state://app')).toBe(true);
      expect(dynamicRegistry.hasResource('state://app/count')).toBe(true);
      expect(dynamicRegistry.hasTool('app_increment')).toBe(true);

      unmount();

      expect(dynamicRegistry.hasResource('state://app')).toBe(false);
      expect(dynamicRegistry.hasResource('state://app/count')).toBe(false);
      expect(dynamicRegistry.hasTool('app_increment')).toBe(false);
    });
  });
});
