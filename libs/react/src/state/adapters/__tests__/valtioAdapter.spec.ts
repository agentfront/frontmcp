import { valtioStore } from '../valtioAdapter';

describe('valtioStore', () => {
  it('returns adapter with default name "valtio"', () => {
    const proxy = { count: 0 };
    const subscribe = jest.fn();
    const adapter = valtioStore({ proxy, subscribe });

    expect(adapter.name).toBe('valtio');
  });

  it('getState returns a snapshot, not the proxy reference', () => {
    const proxy = { count: 10, nested: { value: 'hello' } };
    const subscribe = jest.fn();
    const adapter = valtioStore({ proxy, subscribe });

    const snapshot = adapter.getState();

    expect(snapshot).toEqual({ count: 10, nested: { value: 'hello' } });
    expect(snapshot).not.toBe(proxy);
  });

  it('subscribe wraps valtio subscribe correctly', () => {
    const proxy = { count: 0 };
    const unsub = jest.fn();
    const valtioSubscribe = jest.fn(() => unsub);
    const adapter = valtioStore({ proxy, subscribe: valtioSubscribe });
    const cb = jest.fn();

    const result = adapter.subscribe(cb);

    expect(valtioSubscribe).toHaveBeenCalledWith(proxy, cb);
    expect(result).toBe(unsub);
  });

  it('converts dot-notation paths to selectors', () => {
    const proxy = { user: { name: 'Alice' } };
    const subscribe = jest.fn();
    const adapter = valtioStore({
      proxy,
      subscribe,
      paths: { userName: 'user.name' },
    });

    expect(adapter.selectors).toBeDefined();
    const result = adapter.selectors!.userName({ user: { name: 'Alice' } });
    expect(result).toBe('Alice');
  });

  it('deep path resolves nested values', () => {
    const proxy = { a: { b: { c: { d: 99 } } } };
    const subscribe = jest.fn();
    const adapter = valtioStore({
      proxy,
      subscribe,
      paths: { deep: 'a.b.c.d' },
    });

    const result = adapter.selectors!.deep({ a: { b: { c: { d: 99 } } } });
    expect(result).toBe(99);
  });

  it('deep path returns undefined when intermediate value is null', () => {
    const proxy = { user: null as unknown };
    const subscribe = jest.fn();
    const adapter = valtioStore({
      proxy,
      subscribe,
      paths: { userName: 'user.name' },
    });

    const result = adapter.selectors!.userName({ user: null });
    expect(result).toBeUndefined();
  });

  it('uses custom name when provided', () => {
    const proxy = { count: 0 };
    const subscribe = jest.fn();
    const adapter = valtioStore({ proxy, subscribe, name: 'myValtio' });
    expect(adapter.name).toBe('myValtio');
  });

  it('omits selectors when no paths provided', () => {
    const proxy = { count: 0 };
    const subscribe = jest.fn();
    const adapter = valtioStore({ proxy, subscribe });
    expect(adapter.selectors).toBeUndefined();
  });

  it('omits actions when no mutations provided', () => {
    const proxy = { count: 0 };
    const subscribe = jest.fn();
    const adapter = valtioStore({ proxy, subscribe });
    expect(adapter.actions).toBeUndefined();
  });

  it('wraps mutations as actions', () => {
    const proxy = { count: 0 };
    const subscribe = jest.fn();
    const increment = jest.fn((amount: unknown) => {
      proxy.count += amount as number;
    });
    const adapter = valtioStore({
      proxy,
      subscribe,
      mutations: { increment },
    });

    expect(adapter.actions).toBeDefined();
    adapter.actions!.increment(5);
    expect(increment).toHaveBeenCalledWith(5);
  });
});
