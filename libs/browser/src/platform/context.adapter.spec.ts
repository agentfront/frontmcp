// file: libs/browser/src/platform/context.adapter.spec.ts
/**
 * Tests for BrowserContextStorage
 */

import { BrowserContextStorage, AsyncBrowserContextStorage, createBrowserContextStorage } from './context.adapter';

interface TestContext {
  requestId: string;
  userId?: string;
}

describe('BrowserContextStorage', () => {
  let storage: BrowserContextStorage<TestContext>;

  beforeEach(() => {
    storage = new BrowserContextStorage<TestContext>();
  });

  describe('run', () => {
    it('should set context for the duration of function execution', () => {
      const context: TestContext = { requestId: '123', userId: 'user1' };

      storage.run(context, () => {
        expect(storage.getStore()).toBe(context);
      });
    });

    it('should restore previous context after function completes', () => {
      const context: TestContext = { requestId: '123' };

      expect(storage.getStore()).toBeUndefined();

      storage.run(context, () => {
        expect(storage.getStore()).toBe(context);
      });

      expect(storage.getStore()).toBeUndefined();
    });

    it('should return the function result', () => {
      const result = storage.run({ requestId: '123' }, () => {
        return 'hello';
      });

      expect(result).toBe('hello');
    });

    it('should support nested contexts', () => {
      const outer: TestContext = { requestId: 'outer' };
      const inner: TestContext = { requestId: 'inner' };

      storage.run(outer, () => {
        expect(storage.getStore()?.requestId).toBe('outer');

        storage.run(inner, () => {
          expect(storage.getStore()?.requestId).toBe('inner');
        });

        expect(storage.getStore()?.requestId).toBe('outer');
      });

      expect(storage.getStore()).toBeUndefined();
    });

    it('should restore context even if function throws', () => {
      const context: TestContext = { requestId: '123' };

      expect(() => {
        storage.run(context, () => {
          throw new Error('test error');
        });
      }).toThrow('test error');

      expect(storage.getStore()).toBeUndefined();
    });
  });

  describe('getStore', () => {
    it('should return undefined when not in context', () => {
      expect(storage.getStore()).toBeUndefined();
    });

    it('should return current context when in context', () => {
      const context: TestContext = { requestId: '123' };

      storage.run(context, () => {
        const store = storage.getStore();
        expect(store).toBe(context);
        expect(store?.requestId).toBe('123');
      });
    });
  });

  describe('hasContext', () => {
    it('should return false when not in context', () => {
      expect(storage.hasContext()).toBe(false);
    });

    it('should return true when in context', () => {
      storage.run({ requestId: '123' }, () => {
        expect(storage.hasContext()).toBe(true);
      });
    });
  });

  describe('getDepth', () => {
    it('should return 0 when not in context', () => {
      expect(storage.getDepth()).toBe(0);
    });

    it('should track nesting depth', () => {
      expect(storage.getDepth()).toBe(0);

      storage.run({ requestId: '1' }, () => {
        expect(storage.getDepth()).toBe(1);

        storage.run({ requestId: '2' }, () => {
          expect(storage.getDepth()).toBe(2);

          storage.run({ requestId: '3' }, () => {
            expect(storage.getDepth()).toBe(3);
          });

          expect(storage.getDepth()).toBe(2);
        });

        expect(storage.getDepth()).toBe(1);
      });

      expect(storage.getDepth()).toBe(0);
    });
  });

  describe('clear', () => {
    it('should clear all contexts', () => {
      storage.run({ requestId: '1' }, () => {
        storage.run({ requestId: '2' }, () => {
          storage.clear();
          expect(storage.getStore()).toBeUndefined();
          expect(storage.getDepth()).toBe(0);
        });
      });
    });
  });
});

describe('AsyncBrowserContextStorage', () => {
  let storage: AsyncBrowserContextStorage<TestContext>;

  beforeEach(() => {
    storage = new AsyncBrowserContextStorage<TestContext>();
  });

  describe('sync functions', () => {
    it('should handle sync functions', () => {
      const result = storage.run({ requestId: '123' }, () => {
        expect(storage.getStore()?.requestId).toBe('123');
        return 'sync result';
      });

      expect(result).toBe('sync result');
    });
  });

  describe('getStore', () => {
    it('should return undefined when not in context', () => {
      expect(storage.getStore()).toBeUndefined();
    });

    it('should return current context when in context', () => {
      storage.run({ requestId: '123' }, () => {
        expect(storage.getStore()?.requestId).toBe('123');
      });
    });
  });

  describe('hasContext', () => {
    it('should return false when not in context', () => {
      expect(storage.hasContext()).toBe(false);
    });

    it('should return true when in context', () => {
      storage.run({ requestId: '123' }, () => {
        expect(storage.hasContext()).toBe(true);
      });
    });
  });
});

describe('createBrowserContextStorage', () => {
  it('should create a new storage instance', () => {
    const storage = createBrowserContextStorage<TestContext>();
    expect(storage).toBeInstanceOf(BrowserContextStorage);
  });

  it('should create independent instances', () => {
    const storage1 = createBrowserContextStorage<TestContext>();
    const storage2 = createBrowserContextStorage<TestContext>();

    storage1.run({ requestId: '1' }, () => {
      expect(storage1.getStore()?.requestId).toBe('1');
      expect(storage2.getStore()).toBeUndefined();
    });
  });
});
