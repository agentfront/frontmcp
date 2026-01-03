/**
 * Tests for metadata utilities.
 */

import 'reflect-metadata';
import { getMetadata, setMetadata, hasAsyncWith } from '../utils/metadata.utils.js';
import { META_ASYNC_WITH } from '../tokens/di.constants.js';

describe('metadata utils', () => {
  describe('getMetadata', () => {
    it('should return undefined for non-existent metadata', () => {
      class TestClass {}
      const result = getMetadata<string>('nonexistent', TestClass);
      expect(result).toBeUndefined();
    });

    it('should return metadata set on class', () => {
      class TestClass {}
      const key = Symbol('test-key');
      Reflect.defineMetadata(key, 'test-value', TestClass);

      const result = getMetadata<string>(key, TestClass);
      expect(result).toBe('test-value');
    });

    it('should return metadata set on method', () => {
      class TestClass {
        static myMethod() {}
      }
      const key = Symbol('method-key');
      Reflect.defineMetadata(key, 'method-value', TestClass, 'myMethod');

      const result = getMetadata<string>(key, TestClass, 'myMethod');
      expect(result).toBe('method-value');
    });

    it('should return undefined for wrong property key', () => {
      class TestClass {
        static myMethod() {}
      }
      const key = Symbol('method-key');
      Reflect.defineMetadata(key, 'method-value', TestClass, 'myMethod');

      const result = getMetadata<string>(key, TestClass, 'otherMethod');
      expect(result).toBeUndefined();
    });
  });

  describe('setMetadata', () => {
    it('should set metadata on class', () => {
      class TestClass {}
      const key = Symbol('set-key');

      setMetadata(key, 'set-value', TestClass);

      expect(Reflect.getMetadata(key, TestClass)).toBe('set-value');
    });

    it('should set metadata on method', () => {
      class TestClass {
        static myMethod() {}
      }
      const key = Symbol('set-method-key');

      setMetadata(key, 'set-method-value', TestClass, 'myMethod');

      expect(Reflect.getMetadata(key, TestClass, 'myMethod')).toBe('set-method-value');
    });

    it('should overwrite existing metadata', () => {
      class TestClass {}
      const key = Symbol('overwrite-key');

      setMetadata(key, 'original', TestClass);
      setMetadata(key, 'overwritten', TestClass);

      expect(Reflect.getMetadata(key, TestClass)).toBe('overwritten');
    });
  });

  describe('hasAsyncWith', () => {
    it('should return false for class without async-with metadata', () => {
      class PlainClass {}
      expect(hasAsyncWith(PlainClass)).toBe(false);
    });

    it('should return true for class with async-with metadata', () => {
      class AsyncClass {}
      Reflect.defineMetadata(META_ASYNC_WITH, true, AsyncClass);

      expect(hasAsyncWith(AsyncClass)).toBe(true);
    });

    it('should return false for class with falsy async-with metadata', () => {
      class FalsyClass {}
      Reflect.defineMetadata(META_ASYNC_WITH, false, FalsyClass);

      expect(hasAsyncWith(FalsyClass)).toBe(false);
    });

    it('should return false for class with undefined async-with metadata', () => {
      class UndefinedClass {}
      Reflect.defineMetadata(META_ASYNC_WITH, undefined, UndefinedClass);

      expect(hasAsyncWith(UndefinedClass)).toBe(false);
    });
  });
});
