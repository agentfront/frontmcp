import { findDroppedKeys } from './content';

describe('findDroppedKeys', () => {
  it('names the keys the parsed value lacks, nested ones by their dotted path', () => {
    const original = { id: 'INV-1', costCenter: 'CC-7', customer: { name: 'Ada', taxId: 'T-1' } };
    const parsed = { id: 'INV-1', customer: { name: 'Ada' } };

    expect(findDroppedKeys(original, parsed)).toEqual(['costCenter', 'customer.taxId']);
  });

  it('names a key dropped from array items once, with an [] segment', () => {
    const original = { lines: [{ sku: 'A', margin: 0.4 }, { sku: 'B', margin: 0.1 }, { sku: 'C' }] };
    const parsed = { lines: [{ sku: 'A' }, { sku: 'B' }, { sku: 'C' }] };

    expect(findDroppedKeys(original, parsed)).toEqual(['lines[].margin']);
  });

  it('walks a top-level array', () => {
    expect(findDroppedKeys([{ id: 1, debug: true }], [{ id: 1 }])).toEqual(['[].debug']);
  });

  it('returns the paths sorted', () => {
    expect(findDroppedKeys({ zeta: 1, alpha: 2, kept: 3 }, { kept: 3 })).toEqual(['alpha', 'zeta']);
  });

  it('ignores keys holding undefined, which never reach JSON', () => {
    expect(findDroppedKeys({ id: 1, note: undefined }, { id: 1 })).toEqual([]);
  });

  it('finds nothing when the parsed value keeps every key', () => {
    const value = { id: 1, tags: ['a'], owner: { name: 'Ada' } };

    expect(findDroppedKeys(value, structuredClone(value))).toEqual([]);
  });

  it('does not count inherited properties of the parsed value as kept', () => {
    expect(findDroppedKeys({ id: 1, toString: 'shadow' }, { id: 1 })).toEqual(['toString']);
  });

  it('counts every key of an object that parsing replaced with a non-object as dropped', () => {
    expect(findDroppedKeys({ payload: { secret: 'x', nested: { pin: 1 } } }, { payload: '[object Object]' })).toEqual([
      'payload.nested',
      'payload.secret',
    ]);
    expect(findDroppedKeys([{ id: 1 }], { 0: { id: 1 } })).toEqual(['[].id']);
  });

  it('finds nothing to drop in a primitive answer', () => {
    expect(findDroppedKeys('text', { value: 'text' })).toEqual([]);
    expect(findDroppedKeys(['a', 'b'], 'a,b')).toEqual([]);
  });
});
