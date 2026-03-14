import { reduxStore } from '../reduxAdapter';

function createMockReduxStore(state: unknown = { count: 0 }) {
  const listeners: Array<() => void> = [];
  return {
    getState: jest.fn(() => state),
    dispatch: jest.fn((action: unknown) => action),
    subscribe: jest.fn((fn: () => void) => {
      listeners.push(fn);
      return () => {
        const idx = listeners.indexOf(fn);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    }),
  };
}

describe('reduxStore', () => {
  it('returns adapter with default name "redux"', () => {
    const store = createMockReduxStore();
    const adapter = reduxStore({ store });

    expect(adapter.name).toBe('redux');
  });

  it('uses custom name when provided', () => {
    const store = createMockReduxStore();
    const adapter = reduxStore({ store, name: 'appStore' });

    expect(adapter.name).toBe('appStore');
  });

  it('getState delegates to store.getState', () => {
    const state = { count: 42 };
    const store = createMockReduxStore(state);
    const adapter = reduxStore({ store });

    const result = adapter.getState();

    expect(result).toBe(state);
    expect(store.getState).toHaveBeenCalled();
  });

  it('subscribe delegates to store.subscribe', () => {
    const store = createMockReduxStore();
    const adapter = reduxStore({ store });
    const cb = jest.fn();

    const unsub = adapter.subscribe(cb);

    expect(store.subscribe).toHaveBeenCalledWith(cb);
    expect(typeof unsub).toBe('function');
  });

  it('passes through selectors as-is', () => {
    const store = createMockReduxStore();
    const selectCount = (state: unknown) => (state as { count: number }).count;
    const adapter = reduxStore({ store, selectors: { count: selectCount } });

    expect(adapter.selectors).toBeDefined();
    expect(adapter.selectors!.count).toBe(selectCount);
  });

  it('wraps action creators to auto-dispatch', () => {
    const store = createMockReduxStore();
    const increment = (amount: unknown) => ({ type: 'INCREMENT', payload: amount });
    const adapter = reduxStore({ store, actions: { increment } });

    expect(adapter.actions).toBeDefined();
    adapter.actions!.increment(5);

    expect(store.dispatch).toHaveBeenCalledWith({ type: 'INCREMENT', payload: 5 });
  });
});
