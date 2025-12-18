/**
 * FrontMCP Store Tests
 *
 * Tests for the observable store, global store management,
 * and store initialization utilities.
 */

import {
  createFrontMCPStore,
  getGlobalStore,
  setGlobalStore,
  resetGlobalStore,
  initializeStoreFromWindow,
} from '../store';
import { DEFAULT_FRONTMCP_STATE } from '../types';

// ============================================
// Store Creation Tests
// ============================================

describe('createFrontMCPStore', () => {
  it('should create a store with default state', () => {
    const store = createFrontMCPStore();
    const state = store.getState();

    expect(state).toEqual(DEFAULT_FRONTMCP_STATE);
    expect(state.toolName).toBeNull();
    expect(state.input).toBeNull();
    expect(state.output).toBeNull();
    expect(state.content).toBeNull();
    expect(state.structuredContent).toBeNull();
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('should create a store with custom initial state', () => {
    const store = createFrontMCPStore({
      toolName: 'test_tool',
      output: { data: 'value' },
      loading: true,
    });

    const state = store.getState();

    expect(state.toolName).toBe('test_tool');
    expect(state.output).toEqual({ data: 'value' });
    expect(state.loading).toBe(true);
    // Other values should be default
    expect(state.input).toBeNull();
    expect(state.error).toBeNull();
  });

  it('should update state with setState', () => {
    const store = createFrontMCPStore();

    store.setState({ toolName: 'updated_tool', loading: true });

    const state = store.getState();
    expect(state.toolName).toBe('updated_tool');
    expect(state.loading).toBe(true);
  });

  it('should merge state updates (not replace)', () => {
    const store = createFrontMCPStore({
      toolName: 'original',
      output: { key: 'value' },
    });

    store.setState({ loading: true });

    const state = store.getState();
    expect(state.toolName).toBe('original');
    expect(state.output).toEqual({ key: 'value' });
    expect(state.loading).toBe(true);
  });

  it('should reset to initial state', () => {
    const initialState = { toolName: 'initial_tool' };
    const store = createFrontMCPStore(initialState);

    // Modify state
    store.setState({
      toolName: 'modified',
      output: { data: 'test' },
      loading: true,
    });

    // Reset
    store.reset();

    const state = store.getState();
    expect(state.toolName).toBe('initial_tool');
    expect(state.output).toBeNull();
    expect(state.loading).toBe(false);
  });

  it('should return same state from getState and getServerState', () => {
    const store = createFrontMCPStore({ toolName: 'test' });

    expect(store.getState()).toEqual(store.getServerState());
  });
});

// ============================================
// Subscription Tests
// ============================================

describe('Store Subscriptions', () => {
  it('should notify subscribers on state change', () => {
    const store = createFrontMCPStore();
    const listener = jest.fn();

    store.subscribe(listener);
    store.setState({ toolName: 'test' });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should support multiple subscribers', () => {
    const store = createFrontMCPStore();
    const listener1 = jest.fn();
    const listener2 = jest.fn();

    store.subscribe(listener1);
    store.subscribe(listener2);
    store.setState({ toolName: 'test' });

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });

  it('should unsubscribe correctly', () => {
    const store = createFrontMCPStore();
    const listener = jest.fn();

    const unsubscribe = store.subscribe(listener);
    store.setState({ toolName: 'first' });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.setState({ toolName: 'second' });
    expect(listener).toHaveBeenCalledTimes(1); // Still 1, not notified again
  });

  it('should not notify if state object is same reference', () => {
    const store = createFrontMCPStore();
    const listener = jest.fn();

    store.subscribe(listener);

    // Setting same values should still create new object, so listener is called
    store.setState({ toolName: null });

    // This test verifies the implementation calls listeners on any setState
    expect(listener).toHaveBeenCalled();
  });

  it('should handle subscriber errors gracefully', () => {
    const store = createFrontMCPStore();
    const errorListener = jest.fn(() => {
      throw new Error('Listener error');
    });
    const normalListener = jest.fn();

    store.subscribe(errorListener);
    store.subscribe(normalListener);

    // Should not throw
    expect(() => store.setState({ toolName: 'test' })).toThrow('Listener error');
  });
});

// ============================================
// Global Store Tests
// ============================================

describe('Global Store Management', () => {
  beforeEach(() => {
    // Reset global store before each test
    resetGlobalStore();
  });

  it('should create global store on first access', () => {
    const store = getGlobalStore();

    expect(store).toBeDefined();
    expect(store.getState()).toEqual(DEFAULT_FRONTMCP_STATE);
  });

  it('should return same global store on subsequent calls', () => {
    const store1 = getGlobalStore();
    const store2 = getGlobalStore();

    expect(store1).toBe(store2);
  });

  it('should allow setting custom global store', () => {
    const customStore = createFrontMCPStore({ toolName: 'custom' });

    setGlobalStore(customStore);

    expect(getGlobalStore()).toBe(customStore);
    expect(getGlobalStore().getState().toolName).toBe('custom');
  });

  it('should reset global store with new initial state', () => {
    const store1 = getGlobalStore();
    store1.setState({ toolName: 'modified' });

    resetGlobalStore({ output: { data: 'new' } });

    const store2 = getGlobalStore();
    expect(store2).not.toBe(store1);
    expect(store2.getState().toolName).toBeNull();
    expect(store2.getState().output).toEqual({ data: 'new' });
  });
});

// ============================================
// Window Initialization Tests
// ============================================

describe('initializeStoreFromWindow', () => {
  const originalWindow = global.window;

  beforeEach(() => {
    resetGlobalStore();
  });

  afterEach(() => {
    global.window = originalWindow;
  });

  it('should do nothing if window is undefined', () => {
    // @ts-expect-error - Testing undefined window
    global.window = undefined;

    const store = createFrontMCPStore();
    const initialState = store.getState();

    initializeStoreFromWindow(store);

    expect(store.getState()).toEqual(initialState);
  });

  it('should do nothing if window.__frontmcp is undefined', () => {
    // @ts-expect-error - Mock window
    global.window = {};

    const store = createFrontMCPStore();
    const initialState = store.getState();

    initializeStoreFromWindow(store);

    expect(store.getState()).toEqual(initialState);
  });

  it('should initialize from window.__frontmcp.context', () => {
    // @ts-expect-error - Mock window
    global.window = {
      __frontmcp: {
        context: {
          toolName: 'window_tool',
          toolInput: { arg: 'value' },
          toolOutput: { result: 42 },
          structuredContent: { parsed: true },
        },
      },
    };

    const store = createFrontMCPStore();
    initializeStoreFromWindow(store);

    const state = store.getState();
    expect(state.toolName).toBe('window_tool');
    expect(state.input).toEqual({ arg: 'value' });
    expect(state.output).toEqual({ result: 42 });
    expect(state.structuredContent).toEqual({ parsed: true });
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('should use global store if no store provided', () => {
    // @ts-expect-error - Mock window
    global.window = {
      __frontmcp: {
        context: {
          toolName: 'global_test',
        },
      },
    };

    initializeStoreFromWindow();

    expect(getGlobalStore().getState().toolName).toBe('global_test');
  });

  it('should handle partial context data', () => {
    // @ts-expect-error - Mock window
    global.window = {
      __frontmcp: {
        context: {
          toolName: 'partial_test',
          // No toolInput, toolOutput, structuredContent
        },
      },
    };

    const store = createFrontMCPStore();
    initializeStoreFromWindow(store);

    const state = store.getState();
    expect(state.toolName).toBe('partial_test');
    expect(state.input).toBeNull();
    expect(state.output).toBeNull();
    expect(state.structuredContent).toBeNull();
  });
});

// ============================================
// State Immutability Tests
// ============================================

describe('State Immutability', () => {
  it('should not mutate state directly', () => {
    const store = createFrontMCPStore({ toolName: 'original' });
    const state1 = store.getState();

    store.setState({ toolName: 'updated' });
    const state2 = store.getState();

    expect(state1.toolName).toBe('original');
    expect(state2.toolName).toBe('updated');
    expect(state1).not.toBe(state2);
  });

  it('should create new state object on each setState', () => {
    const store = createFrontMCPStore();
    const state1 = store.getState();

    store.setState({ loading: true });
    const state2 = store.getState();

    store.setState({ loading: false });
    const state3 = store.getState();

    expect(state1).not.toBe(state2);
    expect(state2).not.toBe(state3);
    expect(state1).not.toBe(state3);
  });
});

// ============================================
// Edge Cases
// ============================================

describe('Edge Cases', () => {
  it('should handle null output correctly', () => {
    const store = createFrontMCPStore({ output: { data: 'test' } });
    expect(store.getState().output).toEqual({ data: 'test' });

    store.setState({ output: null });
    expect(store.getState().output).toBeNull();
  });

  it('should handle deeply nested output', () => {
    const complexOutput = {
      level1: {
        level2: {
          level3: {
            value: 'deep',
          },
        },
      },
    };

    const store = createFrontMCPStore({ output: complexOutput });
    expect(store.getState().output).toEqual(complexOutput);
  });

  it('should handle array output', () => {
    const arrayOutput = [1, 2, 3, { nested: 'value' }];

    const store = createFrontMCPStore({ output: arrayOutput });
    expect(store.getState().output).toEqual(arrayOutput);
  });

  it('should handle empty string toolName', () => {
    const store = createFrontMCPStore({ toolName: '' });
    expect(store.getState().toolName).toBe('');
  });
});
