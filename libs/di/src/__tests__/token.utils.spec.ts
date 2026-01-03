/**
 * Tests for token utilities.
 */

import 'reflect-metadata';
import {
  tokenName,
  isClass,
  isPromise,
  getAsyncWithTokens,
  readWithParamTypes,
  depsOfClass,
  depsOfFunc,
} from '../utils/token.utils.js';
import { DESIGN_PARAMTYPES, META_ASYNC_WITH, META_ASYNC_WITH_TOKENS } from '../tokens/di.constants.js';

describe('token utils', () => {
  describe('tokenName', () => {
    it('should return class name for class tokens', () => {
      class MyService {}
      expect(tokenName(MyService)).toBe('MyService');
    });

    it('should return name property for named objects', () => {
      const token = { name: 'CustomToken' };
      expect(tokenName(token as any)).toBe('CustomToken');
    });

    it('should return [ref] for objects without name', () => {
      const token = {};
      expect(tokenName(token as any)).toBe('[ref]');
    });

    it('should return [ref] for null', () => {
      expect(tokenName(null as any)).toBe('[ref]');
    });

    it('should return function name for named functions', () => {
      function myFunction() {}
      expect(tokenName(myFunction)).toBe('myFunction');
    });
  });

  describe('isClass', () => {
    it('should return true for class constructors', () => {
      class MyClass {}
      expect(isClass(MyClass)).toBe(true);
    });

    it('should return true for function constructors', () => {
      function MyFunction() {}
      expect(isClass(MyFunction)).toBe(true);
    });

    it('should return false for arrow functions', () => {
      const arrowFn = () => {};
      // Arrow functions have prototype=undefined
      expect(isClass(arrowFn)).toBe(false);
    });

    it('should return false for objects', () => {
      const obj = {};
      expect(isClass(obj)).toBe(false);
    });

    it('should return false for primitives', () => {
      expect(isClass('string' as any)).toBe(false);
      expect(isClass(123 as any)).toBe(false);
      expect(isClass(null as any)).toBe(false);
      expect(isClass(undefined as any)).toBe(false);
    });
  });

  describe('isPromise', () => {
    it('should return true for native Promises', () => {
      const promise = Promise.resolve();
      expect(isPromise(promise)).toBe(true);
    });

    it('should return true for thenable objects', () => {
      const thenable = { then: () => {} };
      expect(isPromise(thenable)).toBe(true);
    });

    it('should return false for non-thenables', () => {
      expect(isPromise({})).toBe(false);
      expect(isPromise(null)).toBe(false);
      expect(isPromise(undefined)).toBe(false);
      expect(isPromise('string')).toBe(false);
      expect(isPromise(123)).toBe(false);
    });

    it('should return false for objects with non-function then', () => {
      const notThenable = { then: 'not a function' };
      expect(isPromise(notThenable)).toBe(false);
    });
  });

  describe('getAsyncWithTokens', () => {
    it('should return null for class without async-with metadata', () => {
      class PlainClass {}
      expect(getAsyncWithTokens(PlainClass)).toBe(null);
    });

    it('should return tokens from async-with factory', () => {
      class DepA {}
      class DepB {}
      class AsyncClass {}
      Reflect.defineMetadata(META_ASYNC_WITH_TOKENS, () => [DepA, DepB], AsyncClass);

      const tokens = getAsyncWithTokens(AsyncClass);
      expect(tokens).toEqual([DepA, DepB]);
    });

    it('should filter out non-class tokens', () => {
      class DepA {}
      class AsyncClass {}
      Reflect.defineMetadata(META_ASYNC_WITH_TOKENS, () => [DepA, 'string', 123, null], AsyncClass);

      const tokens = getAsyncWithTokens(AsyncClass);
      expect(tokens).toEqual([DepA]);
    });

    it('should handle factory returning empty array', () => {
      class AsyncClass {}
      Reflect.defineMetadata(META_ASYNC_WITH_TOKENS, () => [], AsyncClass);

      const tokens = getAsyncWithTokens(AsyncClass);
      expect(tokens).toEqual([]);
    });

    it('should handle factory returning null/undefined', () => {
      class AsyncClass {}
      Reflect.defineMetadata(META_ASYNC_WITH_TOKENS, () => null, AsyncClass);

      const tokens = getAsyncWithTokens(AsyncClass);
      expect(tokens).toEqual([]);
    });
  });

  describe('readWithParamTypes', () => {
    it('should return tokens from async-with factory if available', () => {
      class DepA {}
      class DepB {}
      class AsyncClass {}
      Reflect.defineMetadata(META_ASYNC_WITH_TOKENS, () => [DepA, DepB], AsyncClass);

      const deps = readWithParamTypes(AsyncClass, 'discovery');
      expect(deps).toEqual([DepA, DepB]);
    });

    it('should fall back to design:paramtypes on with method', () => {
      class DepA {}
      class DepB {}
      class WithClass {
        static with(a: DepA, b: DepB) {}
      }
      Reflect.defineMetadata(DESIGN_PARAMTYPES, [DepA, DepB], WithClass, 'with');

      const deps = readWithParamTypes(WithClass, 'discovery');
      expect(deps).toEqual([DepA, DepB]);
    });

    it('should throw if no metadata available', () => {
      class NoMetaClass {}

      expect(() => readWithParamTypes(NoMetaClass, 'discovery')).toThrow(
        /Cannot discover discovery deps for NoMetaClass.with/,
      );
    });

    it('should throw for TDZ issues in with params', () => {
      class TdzClass {}
      Reflect.defineMetadata(DESIGN_PARAMTYPES, [undefined, class Valid {}], TdzClass, 'with');

      expect(() => readWithParamTypes(TdzClass, 'invocation')).toThrow(/Unresolved dependency at param #0/);
    });

    it('should include all class types (built-ins are classes)', () => {
      class DepA {}
      class WithClass {
        static with(a: DepA, b: string) {}
      }
      Reflect.defineMetadata(DESIGN_PARAMTYPES, [DepA, String], WithClass, 'with');

      const deps = readWithParamTypes(WithClass, 'discovery');
      // String is a class (has prototype), so it's included
      expect(deps).toEqual([DepA, String]);
    });
  });

  describe('depsOfClass', () => {
    it('should use readWithParamTypes for async-with classes', () => {
      class DepA {}
      class AsyncClass {}
      Reflect.defineMetadata(META_ASYNC_WITH, true, AsyncClass);
      Reflect.defineMetadata(META_ASYNC_WITH_TOKENS, () => [DepA], AsyncClass);

      const deps = depsOfClass(AsyncClass, 'discovery');
      expect(deps).toEqual([DepA]);
    });

    it('should read constructor params for regular classes', () => {
      class DepA {}
      class DepB {}
      class RegularClass {
        constructor(a: DepA, b: DepB) {}
      }
      Reflect.defineMetadata(DESIGN_PARAMTYPES, [DepA, DepB], RegularClass);

      const deps = depsOfClass(RegularClass, 'discovery');
      expect(deps).toEqual([DepA, DepB]);
    });

    it('should return empty array for class without constructor deps', () => {
      class NoDepsClass {}

      const deps = depsOfClass(NoDepsClass, 'discovery');
      expect(deps).toEqual([]);
    });

    it('should throw for TDZ issues in constructor', () => {
      class TdzClass {}
      Reflect.defineMetadata(DESIGN_PARAMTYPES, [class Valid {}, undefined], TdzClass);

      expect(() => depsOfClass(TdzClass, 'discovery')).toThrow(
        /Unresolved constructor dependency in TdzClass at param #1/,
      );
    });

    it('should include all class types (built-ins are classes)', () => {
      class DepA {}
      class MixedClass {
        constructor(a: DepA, b: string, c: number) {}
      }
      Reflect.defineMetadata(DESIGN_PARAMTYPES, [DepA, String, Number], MixedClass);

      const deps = depsOfClass(MixedClass, 'discovery');
      // String and Number are classes (have prototypes), so they're included
      expect(deps).toEqual([DepA, String, Number]);
    });
  });

  describe('depsOfFunc', () => {
    it('should read function params, skipping first (input) param', () => {
      class DepA {}
      class DepB {}
      function myFunc(input: any, a: DepA, b: DepB) {}
      Reflect.defineMetadata(DESIGN_PARAMTYPES, [Object, DepA, DepB], myFunc);

      const deps = depsOfFunc(myFunc, 'discovery');
      expect(deps).toEqual([DepA, DepB]);
    });

    it('should return empty array for function with only input param', () => {
      function singleParam(input: any) {}
      Reflect.defineMetadata(DESIGN_PARAMTYPES, [Object], singleParam);

      const deps = depsOfFunc(singleParam, 'discovery');
      expect(deps).toEqual([]);
    });

    it('should return empty array for function without metadata', () => {
      function noMeta() {}

      const deps = depsOfFunc(noMeta, 'discovery');
      expect(deps).toEqual([]);
    });

    it('should throw for TDZ issues in function params', () => {
      function tdzFunc(input: any, dep: any) {}
      Reflect.defineMetadata(DESIGN_PARAMTYPES, [Object, undefined], tdzFunc);

      expect(() => depsOfFunc(tdzFunc, 'invocation')).toThrow(/Unresolved function dependency in tdzFunc at param #0/);
    });

    it('should include all class types (built-ins are classes)', () => {
      class DepA {}
      function mixedFunc(input: any, a: DepA, b: string) {}
      Reflect.defineMetadata(DESIGN_PARAMTYPES, [Object, DepA, String], mixedFunc);

      const deps = depsOfFunc(mixedFunc, 'discovery');
      // String is a class (has prototype), so it's included
      expect(deps).toEqual([DepA, String]);
    });
  });
});
