// file: libs/browser/src/platform/storage.adapter.spec.ts
/**
 * Tests for BrowserStorageAdapter
 */

import { BrowserStorageAdapter, browserStorage } from './storage.adapter';

describe('BrowserStorageAdapter', () => {
  describe('memory storage', () => {
    let storage: BrowserStorageAdapter;

    beforeEach(() => {
      storage = new BrowserStorageAdapter({ type: 'memory' });
    });

    it('should set and get values', async () => {
      await storage.set('key1', 'value1');
      const value = await storage.get('key1');
      expect(value).toBe('value1');
    });

    it('should return null for non-existent keys', async () => {
      const value = await storage.get('nonexistent');
      expect(value).toBeNull();
    });

    it('should delete values', async () => {
      await storage.set('key1', 'value1');
      await storage.delete('key1');
      const value = await storage.get('key1');
      expect(value).toBeNull();
    });

    it('should check if key exists', async () => {
      await storage.set('key1', 'value1');
      expect(await storage.has('key1')).toBe(true);
      expect(await storage.has('nonexistent')).toBe(false);
    });

    it('should clear all values with prefix', async () => {
      await storage.set('key1', 'value1');
      await storage.set('key2', 'value2');
      await storage.clear();
      expect(await storage.get('key1')).toBeNull();
      expect(await storage.get('key2')).toBeNull();
    });

    it('should use memory storage type', () => {
      expect(storage.getStorageType()).toBe('memory');
    });

    it('should report native storage not available', () => {
      expect(storage.isNativeStorageAvailable()).toBe(false);
    });
  });

  describe('with custom prefix', () => {
    let storage: BrowserStorageAdapter;

    beforeEach(() => {
      storage = new BrowserStorageAdapter({ type: 'memory', prefix: 'myapp:' });
    });

    it('should use custom prefix', async () => {
      await storage.set('key1', 'value1');
      const value = await storage.get('key1');
      expect(value).toBe('value1');
    });

    it('should isolate values by prefix', async () => {
      const storage2 = new BrowserStorageAdapter({ type: 'memory', prefix: 'other:' });

      await storage.set('key', 'value1');
      await storage2.set('key', 'value2');

      expect(await storage.get('key')).toBe('value1');
      expect(await storage2.get('key')).toBe('value2');
    });
  });

  describe('localStorage mock', () => {
    let storage: BrowserStorageAdapter;
    let mockLocalStorage: { [key: string]: string };

    beforeEach(() => {
      mockLocalStorage = {};

      // Mock localStorage
      Object.defineProperty(global, 'localStorage', {
        value: {
          getItem: jest.fn((key: string) => mockLocalStorage[key] ?? null),
          setItem: jest.fn((key: string, value: string) => {
            mockLocalStorage[key] = value;
          }),
          removeItem: jest.fn((key: string) => {
            delete mockLocalStorage[key];
          }),
          key: jest.fn((index: number) => Object.keys(mockLocalStorage)[index] ?? null),
          get length() {
            return Object.keys(mockLocalStorage).length;
          },
          clear: jest.fn(() => {
            mockLocalStorage = {};
          }),
        },
        writable: true,
        configurable: true,
      });

      storage = new BrowserStorageAdapter({ type: 'local' });
    });

    afterEach(() => {
      // @ts-expect-error - cleaning up mock
      delete global.localStorage;
    });

    it('should use localStorage', () => {
      expect(storage.getStorageType()).toBe('local');
      expect(storage.isNativeStorageAvailable()).toBe(true);
    });

    it('should set and get values through localStorage', async () => {
      await storage.set('key1', 'value1');
      expect(mockLocalStorage['frontmcp:key1']).toBe('value1');

      const value = await storage.get('key1');
      expect(value).toBe('value1');
    });
  });

  describe('singleton', () => {
    it('should export a singleton instance', () => {
      expect(browserStorage).toBeInstanceOf(BrowserStorageAdapter);
    });
  });

  describe('edge cases', () => {
    it('should handle empty string values', async () => {
      const storage = new BrowserStorageAdapter({ type: 'memory' });
      await storage.set('key', '');
      const value = await storage.get('key');
      expect(value).toBe('');
    });

    it('should handle JSON values', async () => {
      const storage = new BrowserStorageAdapter({ type: 'memory' });
      const data = JSON.stringify({ name: 'test', count: 42 });
      await storage.set('json', data);
      const value = await storage.get('json');
      expect(JSON.parse(value!)).toEqual({ name: 'test', count: 42 });
    });

    it('should handle unicode values', async () => {
      const storage = new BrowserStorageAdapter({ type: 'memory' });
      await storage.set('unicode', '日本語テスト 🚀');
      const value = await storage.get('unicode');
      expect(value).toBe('日本語テスト 🚀');
    });
  });
});
