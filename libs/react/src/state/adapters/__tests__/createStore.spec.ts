import { createStore } from '../createStore';

describe('createStore', () => {
  it('returns adapter with all provided fields', () => {
    const getState = jest.fn(() => ({ count: 1 }));
    const subscribe = jest.fn(() => jest.fn());
    const selectors = { count: (s: unknown) => (s as { count: number }).count };
    const actions = { reset: jest.fn() };

    const adapter = createStore({
      name: 'custom',
      getState,
      subscribe,
      selectors,
      actions,
    });

    expect(adapter.getState).toBe(getState);
    expect(adapter.subscribe).toBe(subscribe);
    expect(adapter.selectors).toBe(selectors);
    expect(adapter.actions).toBe(actions);
  });

  it('name matches input', () => {
    const adapter = createStore({
      name: 'myStore',
      getState: () => null,
      subscribe: () => () => undefined,
    });

    expect(adapter.name).toBe('myStore');
  });

  it('optional selectors and actions are preserved', () => {
    const adapter = createStore({
      name: 'bare',
      getState: () => ({}),
      subscribe: () => () => undefined,
    });

    expect(adapter.selectors).toBeUndefined();
    expect(adapter.actions).toBeUndefined();
  });
});
