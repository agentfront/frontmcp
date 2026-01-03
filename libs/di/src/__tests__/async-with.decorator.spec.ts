/**
 * Tests for AsyncWith decorator.
 */

import 'reflect-metadata';
import { AsyncWith } from '../decorators/async-with.decorator.js';
import { META_ASYNC_WITH, META_ASYNC_WITH_TOKENS } from '../tokens/di.constants.js';

describe('AsyncWith decorator', () => {
  it('should set META_ASYNC_WITH to true', () => {
    class DepA {}

    @AsyncWith(() => [DepA])
    class TestClass {}

    const hasAsync = Reflect.getMetadata(META_ASYNC_WITH, TestClass);
    expect(hasAsync).toBe(true);
  });

  it('should store token factory function', () => {
    class DepA {}
    class DepB {}

    @AsyncWith(() => [DepA, DepB])
    class TestClass {}

    const tokensFactory = Reflect.getMetadata(META_ASYNC_WITH_TOKENS, TestClass);
    expect(typeof tokensFactory).toBe('function');
    expect(tokensFactory()).toEqual([DepA, DepB]);
  });

  it('should work with empty dependency array', () => {
    @AsyncWith(() => [])
    class NoDepClass {}

    const hasAsync = Reflect.getMetadata(META_ASYNC_WITH, NoDepClass);
    const tokensFactory = Reflect.getMetadata(META_ASYNC_WITH_TOKENS, NoDepClass);

    expect(hasAsync).toBe(true);
    expect(tokensFactory()).toEqual([]);
  });

  it('should work with single dependency', () => {
    class SingleDep {}

    @AsyncWith(() => [SingleDep])
    class SingleDepClass {}

    const tokensFactory = Reflect.getMetadata(META_ASYNC_WITH_TOKENS, SingleDepClass);
    expect(tokensFactory()).toEqual([SingleDep]);
  });

  it('should preserve lazy evaluation of dependencies', () => {
    // This tests TDZ avoidance - factory is called lazily
    // eslint-disable-next-line prefer-const -- reassigned below
    let DepClass: any;

    @AsyncWith(() => [DepClass])
    class LazyClass {}

    // DepClass is undefined at decoration time
    const tokensFactory = Reflect.getMetadata(META_ASYNC_WITH_TOKENS, LazyClass);

    // Now define the dependency
    DepClass = class Dep {};

    // Factory should now return the defined class
    expect(tokensFactory()).toEqual([DepClass]);
  });

  it('should not interfere with class prototype', () => {
    class Dep {}

    @AsyncWith(() => [Dep])
    class TestClass {
      value = 42;
      method() {
        return this.value;
      }
    }

    const instance = new TestClass();
    expect(instance.value).toBe(42);
    expect(instance.method()).toBe(42);
  });

  it('should work with inheritance', () => {
    class Dep {}

    @AsyncWith(() => [Dep])
    class BaseClass {}

    class DerivedClass extends BaseClass {}

    // Metadata is on BaseClass, not DerivedClass
    const baseHasAsync = Reflect.getMetadata(META_ASYNC_WITH, BaseClass);
    expect(baseHasAsync).toBe(true);
  });

  it('should handle readonly tuple type', () => {
    class DepA {}
    class DepB {}
    class DepC {}

    // Type should accept readonly arrays
    @AsyncWith(() => [DepA, DepB, DepC] as const)
    class ReadonlyDeps {}

    const tokensFactory = Reflect.getMetadata(META_ASYNC_WITH_TOKENS, ReadonlyDeps);
    expect(tokensFactory()).toHaveLength(3);
  });
});
