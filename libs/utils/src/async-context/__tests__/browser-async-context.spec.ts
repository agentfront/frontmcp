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
