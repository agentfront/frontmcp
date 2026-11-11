import { runInNewContext } from 'node:vm';

import { canonicalJson } from '../canonical-json';

describe('canonicalJson', () => {
  it('sorts the keys of an object', () => {
    expect(canonicalJson({ b: 1, a: 2, c: 3 })).toBe('{"a":2,"b":1,"c":3}');
  });

  it('sorts the keys of nested objects and of objects in arrays', () => {
    const value = { z: { y: 1, x: [{ b: true, a: null }] }, a: 'first' };

    expect(canonicalJson(value)).toBe('{"a":"first","z":{"x":[{"a":null,"b":true}],"y":1}}');
  });

  it('gives the same text whatever order the members were written in', () => {
    const left = { repo: 'acme/web', labels: ['bug', 'p1'], filter: { severity: 'P1', team: 'core' } };
    const right = { filter: { team: 'core', severity: 'P1' }, labels: ['bug', 'p1'], repo: 'acme/web' };

    expect(canonicalJson(left)).toBe(canonicalJson(right));
  });

  it('keeps the order of an array', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson({ labels: ['p1', 'bug'] })).not.toBe(canonicalJson({ labels: ['bug', 'p1'] }));
  });

  it('orders keys by UTF-16 code unit, as RFC 8785 does', () => {
    const value = { '\u20ac': 1, '\r': 2, '\ud83d\ude00': 3, '1': 4, a: 5, B: 6, '': 7, '\u00f6': 8 };

    expect(canonicalJson(value)).toBe('{"":7,"\\r":2,"1":4,"B":6,"a":5,"\u00f6":8,"\u20ac":1,"\ud83d\ude00":3}');
  });

  it('does not put integer-like keys first, as an object does', () => {
    expect(canonicalJson({ b: 1, 10: 2, 9: 3, a: 4 })).toBe('{"10":2,"9":3,"a":4,"b":1}');
  });

  it('drops members that are undefined', () => {
    expect(canonicalJson({ a: 1, b: undefined, c: { d: undefined } })).toBe('{"a":1,"c":{}}');
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it('keeps members that are null, false, zero or empty', () => {
    expect(canonicalJson({ a: null, b: false, c: 0, d: '', e: [], f: {} })).toBe(
      '{"a":null,"b":false,"c":0,"d":"","e":[],"f":{}}',
    );
  });

  it.each([
    [null, 'null'],
    [true, 'true'],
    [false, 'false'],
    [0, '0'],
    [-0, '0'],
    [1.5, '1.5'],
    [1e21, '1e+21'],
    [-12, '-12'],
    ['', '""'],
    ['a "quoted" line\n', '"a \\"quoted\\" line\\n"'],
    [[], '[]'],
    [{}, '{}'],
  ])('serializes %p as JSON.stringify does', (value, text) => {
    expect(canonicalJson(value)).toBe(text);
    expect(canonicalJson(value)).toBe(JSON.stringify(value));
  });

  it('writes no whitespace', () => {
    expect(canonicalJson({ a: [1, { b: 2 }], c: 'd e' })).toBe('{"a":[1,{"b":2}],"c":"d e"}');
  });

  it('gives text that parses back to the value', () => {
    const value = { name: 'incident.created', arguments: { severity: ['P1', 'P2'], since: 1700000000, open: true } };

    expect(JSON.parse(canonicalJson(value))).toEqual(value);
  });

  it('serializes what toJSON returns, as JSON.stringify does', () => {
    const at = new Date('2026-02-19T16:00:00.000Z');
    const custom = { toJSON: () => ({ b: 1, a: at }) };

    expect(canonicalJson({ at })).toBe('{"at":"2026-02-19T16:00:00.000Z"}');
    expect(canonicalJson(custom)).toBe('{"a":"2026-02-19T16:00:00.000Z","b":1}');
  });

  it('accepts an object without a prototype and one from another realm', () => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { b: 1, a: 2 });
    const foreign: unknown = runInNewContext('({ b: [1], a: { d: 1, c: 2 } })');

    expect(canonicalJson(bare)).toBe('{"a":2,"b":1}');
    expect(canonicalJson(foreign)).toBe('{"a":{"c":2,"d":1},"b":[1]}');
  });

  it('accepts the same object twice when it is not its own ancestor', () => {
    const shared = { b: 1, a: 2 };

    expect(canonicalJson({ first: shared, second: [shared, shared] })).toBe(
      '{"first":{"a":2,"b":1},"second":[{"a":2,"b":1},{"a":2,"b":1}]}',
    );
  });

  it.each([
    ['undefined', undefined, 'undefined'],
    ['a function', () => 1, 'function'],
    ['a symbol', Symbol('s'), 'symbol'],
    ['a bigint', 10n, 'bigint'],
    ['NaN', Number.NaN, 'NaN'],
    ['Infinity', Number.POSITIVE_INFINITY, 'Infinity'],
    ['-Infinity', Number.NEGATIVE_INFINITY, '-Infinity'],
  ])('refuses %s', (_case, value, description) => {
    expect(() => canonicalJson(value)).toThrow(new TypeError(`canonicalJson: ${description} is not a JSON value`));
  });

  it.each([
    ['a function member', { a: 1, run: () => 1 }, 'function'],
    ['a symbol member', { a: Symbol('s') }, 'symbol'],
    ['a bigint in an array', { a: [1, 2n] }, 'bigint'],
    ['an undefined array element', [1, undefined, 3], 'undefined'],
    ['a hole in an array', Object.assign(new Array<number>(3), { 0: 1, 2: 3 }), 'undefined'],
    ['a nested NaN', { a: { b: [Number.NaN] } }, 'NaN'],
    ['a toJSON that returns undefined', { toJSON: () => undefined }, 'undefined'],
  ])('refuses %s', (_case, value, description) => {
    expect(() => canonicalJson(value)).toThrow(new TypeError(`canonicalJson: ${description} is not a JSON value`));
  });

  it.each([
    ['a Map', new Map([['a', 1]])],
    ['a Set', new Set([1])],
    ['a typed array', new Uint8Array([1, 2])],
    [
      'a class instance',
      new (class Point {
        x = 1;
      })(),
    ],
    ['a RegExp', /a/],
  ])('refuses %s, which JSON.stringify would empty', (_case, value) => {
    expect(() => canonicalJson({ value })).toThrow(
      new TypeError('canonicalJson: a class instance is not a JSON value'),
    );
  });

  it('refuses an object that contains itself', () => {
    const node: Record<string, unknown> = { name: 'root' };
    node['self'] = node;

    expect(() => canonicalJson(node)).toThrow(new TypeError('canonicalJson: a circular reference is not a JSON value'));
  });

  it('refuses a cycle through an array, and a toJSON that returns its own object', () => {
    const list: unknown[] = [];
    list.push({ list });
    const selfish: { toJSON: () => unknown } = { toJSON: () => selfish };

    expect(() => canonicalJson(list)).toThrow('a circular reference');
    expect(() => canonicalJson(selfish)).toThrow('a circular reference');
  });
});
