// file: libs/plugins/src/codecall/__tests__/plain-json.spec.ts

import { toPlainJson } from '../utils';

describe('toPlainJson', () => {
  it('returns a structurally equal copy of plain data', () => {
    const source = { type: 'object', properties: { limit: { type: 'number' } } };

    const copy = toPlainJson(source);

    expect(copy).toEqual(source);
    expect(copy).not.toBe(source);
    expect(copy?.properties).not.toBe(source.properties);
  });

  it('drops prototypes and non-serializable members', () => {
    class Schema {
      readonly type = 'object';
      parse(): void {
        /* noop */
      }
    }

    const copy = toPlainJson(new Schema()) as Record<string, unknown>;

    expect(copy).toEqual({ type: 'object' });
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect(copy['parse']).toBeUndefined();
  });

  it('returns undefined for values with no JSON representation', () => {
    expect(toPlainJson(undefined)).toBeUndefined();
    expect(toPlainJson(() => 'x')).toBeUndefined();
  });

  it('returns undefined for circular structures', () => {
    const circular: Record<string, unknown> = { name: 'loop' };
    circular['self'] = circular;

    expect(toPlainJson(circular)).toBeUndefined();
  });

  it('flattens pinned non-configurable properties into ordinary data', () => {
    const source = { type: 'object' };
    Object.defineProperty(source, 'internal', {
      value: { owner: source },
      configurable: false,
      writable: false,
      enumerable: true,
    });

    const copy = toPlainJson(source) as Record<string, unknown>;

    // Circular back-reference makes this unrepresentable, so nothing crosses at all.
    expect(copy).toBeUndefined();
  });

  it('copies a pinned property as a plain, reconfigurable value when it is acyclic', () => {
    const source: Record<string, unknown> = { type: 'object' };
    Object.defineProperty(source, 'internal', {
      value: { tag: 'inner' },
      configurable: false,
      writable: false,
      enumerable: true,
    });

    const copy = toPlainJson(source) as Record<string, unknown>;

    expect(copy).toEqual({ type: 'object', internal: { tag: 'inner' } });
    expect(Object.getOwnPropertyDescriptor(copy, 'internal')).toMatchObject({
      configurable: true,
      writable: true,
    });
  });

  it('preserves primitives and arrays', () => {
    expect(toPlainJson('text')).toBe('text');
    expect(toPlainJson(42)).toBe(42);
    expect(toPlainJson(null)).toBeNull();
    expect(toPlainJson([1, 'two', { three: true }])).toEqual([1, 'two', { three: true }]);
  });
});
