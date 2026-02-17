/**
 * Unit tests for BrowserContextStorage
 *
 * Tests the stack-based context storage used in browser environments.
 */

import { BrowserContextStorage } from '../context-storage.browser';

describe('BrowserContextStorage', () => {
  let storage: BrowserContextStorage<string>;

  beforeEach(() => {
    storage = new BrowserContextStorage<string>();
  });

  describe('getStore', () => {
    it('should return undefined when no context is active', () => {
      expect(storage.getStore()).toBeUndefined();
    });
  });

  describe('run (synchronous)', () => {
    it('should make the store available inside the callback', () => {
      storage.run('ctx-1', () => {
        expect(storage.getStore()).toBe('ctx-1');
      });
    });

    it('should return the callback result', () => {
      const result = storage.run('ctx-1', () => 42);
      expect(result).toBe(42);
    });

    it('should clean up after the callback returns', () => {
      storage.run('ctx-1', () => {});
      expect(storage.getStore()).toBeUndefined();
    });

    it('should clean up after the callback throws', () => {
      expect(() => {
        storage.run('ctx-1', () => {
          throw new Error('oops');
        });
      }).toThrow('oops');
      expect(storage.getStore()).toBeUndefined();
    });
  });

  describe('run (async)', () => {
    it('should make the store available inside an async callback', async () => {
      await storage.run('ctx-async', async () => {
        await new Promise((r) => setTimeout(r, 5));
        expect(storage.getStore()).toBe('ctx-async');
      });
    });

    it('should return the async callback result', async () => {
      const result = await storage.run('ctx-async', async () => {
        await new Promise((r) => setTimeout(r, 5));
        return 'done';
      });
      expect(result).toBe('done');
    });

    it('should clean up after the async callback resolves', async () => {
      await storage.run('ctx-async', async () => {
        await new Promise((r) => setTimeout(r, 5));
      });
      expect(storage.getStore()).toBeUndefined();
    });

    it('should clean up after the async callback rejects', async () => {
      await expect(
        storage.run('ctx-async', async () => {
          await new Promise((r) => setTimeout(r, 5));
          throw new Error('async oops');
        }),
      ).rejects.toThrow('async oops');
      expect(storage.getStore()).toBeUndefined();
    });
  });

  describe('nested contexts', () => {
    it('should support nested synchronous contexts', () => {
      storage.run('outer', () => {
        expect(storage.getStore()).toBe('outer');

        storage.run('inner', () => {
          expect(storage.getStore()).toBe('inner');
        });

        // Outer context is restored after inner completes
        expect(storage.getStore()).toBe('outer');
      });
      expect(storage.getStore()).toBeUndefined();
    });

    it('should support nested async contexts', async () => {
      await storage.run('outer', async () => {
        expect(storage.getStore()).toBe('outer');

        await storage.run('inner', async () => {
          await new Promise((r) => setTimeout(r, 5));
          expect(storage.getStore()).toBe('inner');
        });

        expect(storage.getStore()).toBe('outer');
      });
      expect(storage.getStore()).toBeUndefined();
    });

    it('should restore outer context when inner throws', () => {
      storage.run('outer', () => {
        try {
          storage.run('inner', () => {
            throw new Error('inner error');
          });
        } catch {
          // expected
        }
        expect(storage.getStore()).toBe('outer');
      });
    });

    it('should restore outer context when inner async rejects', async () => {
      await storage.run('outer', async () => {
        try {
          await storage.run('inner', async () => {
            throw new Error('inner async error');
          });
        } catch {
          // expected
        }
        expect(storage.getStore()).toBe('outer');
      });
    });
  });

  describe('IContextStorage interface compliance', () => {
    it('should implement run() and getStore()', () => {
      expect(typeof storage.run).toBe('function');
      expect(typeof storage.getStore).toBe('function');
    });

    it('should work with object stores', () => {
      const objStorage = new BrowserContextStorage<{ id: number; name: string }>();
      const store = { id: 1, name: 'test' };

      objStorage.run(store, () => {
        const current = objStorage.getStore();
        expect(current).toBe(store);
        expect(current?.id).toBe(1);
        expect(current?.name).toBe('test');
      });
    });
  });
});
