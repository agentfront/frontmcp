import { AsyncLocalStorage } from '../browser-async-context';

describe('Browser AsyncLocalStorage polyfill', () => {
  it('should be constructable', () => {
    const storage = new AsyncLocalStorage<string>();
    expect(storage).toBeInstanceOf(AsyncLocalStorage);
  });

  it('should return undefined from getStore() when not in a run context', () => {
    const storage = new AsyncLocalStorage<string>();
    expect(storage.getStore()).toBeUndefined();
  });

  it('should provide the store value inside run()', () => {
    const storage = new AsyncLocalStorage<string>();
    storage.run('hello', () => {
      expect(storage.getStore()).toBe('hello');
    });
  });

  it('should return undefined after run() completes', () => {
    const storage = new AsyncLocalStorage<string>();
    storage.run('hello', () => {
      // inside run
    });
    expect(storage.getStore()).toBeUndefined();
  });

  it('should support nested run() calls with different stores', () => {
    const storage = new AsyncLocalStorage<string>();
    storage.run('outer', () => {
      expect(storage.getStore()).toBe('outer');
      storage.run('inner', () => {
        expect(storage.getStore()).toBe('inner');
      });
      expect(storage.getStore()).toBe('outer');
    });
    expect(storage.getStore()).toBeUndefined();
  });

  it('should restore store after exception in callback', () => {
    const storage = new AsyncLocalStorage<string>();
    storage.run('outer', () => {
      expect(() => {
        storage.run('inner', () => {
          throw new Error('test error');
        });
      }).toThrow('test error');
      expect(storage.getStore()).toBe('outer');
    });
  });

  it('should return the callback return value from run()', () => {
    const storage = new AsyncLocalStorage<number>();
    const result = storage.run(42, () => {
      return storage.getStore()! * 2;
    });
    expect(result).toBe(84);
  });

  it('should pass extra arguments to callback', () => {
    const storage = new AsyncLocalStorage<string>();
    const result = storage.run(
      'store',
      (a: unknown, b: unknown) => {
        return `${storage.getStore()}-${a}-${b}`;
      },
      'arg1',
      'arg2',
    );
    expect(result).toBe('store-arg1-arg2');
  });

  it('should support object stores', () => {
    const storage = new AsyncLocalStorage<{ userId: string }>();
    const store = { userId: 'user-123' };
    storage.run(store, () => {
      expect(storage.getStore()).toBe(store);
      expect(storage.getStore()?.userId).toBe('user-123');
    });
  });

  it('should handle multiple independent instances', () => {
    const storage1 = new AsyncLocalStorage<string>();
    const storage2 = new AsyncLocalStorage<number>();
    storage1.run('hello', () => {
      storage2.run(42, () => {
        expect(storage1.getStore()).toBe('hello');
        expect(storage2.getStore()).toBe(42);
      });
      expect(storage2.getStore()).toBeUndefined();
    });
  });
});

describe('Browser AsyncLocalStorage without AsyncContext: requests take turns', () => {
  // Loaded fresh so the module-level turn state does not leak between tests.
  function load(): typeof import('../browser-async-context') {
    let mod: typeof import('../browser-async-context') | undefined;
    jest.isolateModules(() => {
      mod = jest.requireActual<typeof import('../browser-async-context')>('../browser-async-context');
    });
    if (!mod) throw new Error('module did not load');
    return mod;
  }

  const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

  it('reports the serialized mode', () => {
    expect(load().getAsyncContextMode()).toBe('serialized');
  });

  it('keeps each overlapping request on its own store across awaits', async () => {
    const { AsyncLocalStorage: Storage, runRequestExclusive } = load();
    const storage = new Storage<string>();
    const seen: Record<string, Array<string | undefined>> = { a: [], b: [] };

    const request = (name: 'a' | 'b', delay: number) =>
      runRequestExclusive(() =>
        storage.run(name, async () => {
          seen[name].push(storage.getStore());
          await tick(delay);
          seen[name].push(storage.getStore());
        }),
      );

    await Promise.all([request('a', 20), request('b', 5)]);

    expect(seen).toEqual({ a: ['a', 'a'], b: ['b', 'b'] });
    expect(storage.getStore()).toBeUndefined();
  });

  it('runs the next request only after the previous one, and everything it left running, has finished', async () => {
    const { AsyncLocalStorage: Storage, runRequestExclusive } = load();
    const storage = new Storage<string>();
    const order: string[] = [];
    let releaseLeftover: () => void = () => undefined;

    const first = runRequestExclusive(() => {
      // Started but not awaited: the request's turn lasts until it unwinds too.
      void storage.run('first', async () => {
        await new Promise<void>((resolve) => (releaseLeftover = resolve));
        order.push(`leftover sees ${storage.getStore()}`);
      });
      order.push('first returned');
    });
    const second = runRequestExclusive(() => {
      order.push(`second sees ${storage.getStore()}`);
    });

    await tick(5);
    // The first request returned, but its leftover run still holds the turn.
    expect(order).toEqual(['first returned']);
    releaseLeftover();
    await Promise.all([first, second]);
    expect(order).toEqual(['first returned', 'leftover sees first', 'second sees undefined']);
  });

  it('lets another request run while one awaits outside it, then resumes it on its own store', async () => {
    const { AsyncLocalStorage: Storage, awaitOutsideRequest, runRequestExclusive } = load();
    const storage = new Storage<string>();
    let answer: (value: string) => void = () => undefined;
    const answered = new Promise<string>((resolve) => (answer = resolve));

    const asking = runRequestExclusive(() =>
      storage.run('asking', async () => {
        const reply = await awaitOutsideRequest(answered);
        return `${storage.getStore()} got ${reply}`;
      }),
    );
    // The client answers only after calling the server itself.
    const clientCall = runRequestExclusive(() =>
      storage.run('client', async () => {
        const seen = storage.getStore();
        answer('yes');
        return seen;
      }),
    );

    await expect(clientCall).resolves.toBe('client');
    await expect(asking).resolves.toBe('asking got yes');
  });

  it('refuses to answer when two runs of one storage overlap inside a request', async () => {
    const { AsyncLocalStorage: Storage, AsyncContextOverlapError, runRequestExclusive } = load();
    const storage = new Storage<string>();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const outcome = runRequestExclusive(async () => {
      const slow = storage.run('slow', async () => {
        await tick(20);
        return 'slow';
      });
      const fast = storage.run('fast', async () => {
        await tick(40);
        return storage.getStore();
      });
      return Promise.allSettled([slow, fast]);
    });

    const [slow, fast] = await outcome;
    expect(slow.status).toBe('rejected');
    expect((slow as PromiseRejectedResult).reason).toBeInstanceOf(AsyncContextOverlapError);
    expect(fast.status).toBe('rejected');
    expect((fast as PromiseRejectedResult).reason).toBeInstanceOf(AsyncContextOverlapError);
    // Once both unwound, the storage answers again.
    expect(storage.getStore()).toBeUndefined();
    await expect(runRequestExclusive(() => storage.run('next', async () => storage.getStore()))).resolves.toBe('next');
  });

  it('keeps nested runs of one storage working', async () => {
    const { AsyncLocalStorage: Storage, runRequestExclusive } = load();
    const storage = new Storage<string>();

    const seen = await runRequestExclusive(() =>
      storage.run('outer', async () => {
        await tick(1);
        const inner = await storage.run('inner', async () => {
          await tick(1);
          return storage.getStore();
        });
        return [inner, storage.getStore()];
      }),
    );

    expect(seen).toEqual(['inner', 'outer']);
  });
});

describe('Browser AsyncLocalStorage with AsyncContext', () => {
  afterEach(() => {
    delete (globalThis as { AsyncContext?: unknown }).AsyncContext;
  });

  it('uses AsyncContext.Variable and lets requests overlap', async () => {
    const { AsyncLocalStorage: NodeStorage } =
      jest.requireActual<typeof import('node:async_hooks')>('node:async_hooks');
    class Variable<T> {
      private readonly als = new NodeStorage<T>();
      run<R>(value: T, fn: (...args: unknown[]) => R, ...args: unknown[]): R {
        return this.als.run(value, fn, ...args);
      }
      get(): T | undefined {
        return this.als.getStore();
      }
    }
    (globalThis as { AsyncContext?: unknown }).AsyncContext = { Variable };

    let mod: typeof import('../browser-async-context') | undefined;
    jest.isolateModules(() => {
      mod = jest.requireActual<typeof import('../browser-async-context')>('../browser-async-context');
    });
    if (!mod) throw new Error('module did not load');
    const { AsyncLocalStorage: Storage, getAsyncContextMode, runRequestExclusive } = mod;
    expect(getAsyncContextMode()).toBe('native');

    const storage = new Storage<string>();
    const events: string[] = [];
    let releaseA: () => void = () => undefined;
    const a = runRequestExclusive(() =>
      storage.run('a', async () => {
        await new Promise<void>((resolve) => (releaseA = resolve));
        events.push(`a sees ${storage.getStore()}`);
      }),
    );
    // With native context, b does not wait for a.
    await runRequestExclusive(() => storage.run('b', async () => events.push(`b sees ${storage.getStore()}`)));
    releaseA();
    await a;

    expect(events).toEqual(['b sees b', 'a sees a']);
  });
});
