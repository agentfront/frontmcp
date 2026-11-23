import { countResultValues } from '../utils/value-count';

describe('countResultValues', () => {
  it('counts nothing in a primitive, null or an empty container', () => {
    expect(countResultValues('text')).toBe(0);
    expect(countResultValues(null)).toBe(0);
    expect(countResultValues(undefined)).toBe(0);
    expect(countResultValues({})).toBe(0);
    expect(countResultValues([])).toBe(0);
  });

  it('counts array items and object keys at every depth', () => {
    const page = { items: Array.from({ length: 700 }, (_, index) => ({ id: index, name: 'n' })) };

    expect(countResultValues(page)).toBe(2101);
    expect(countResultValues([[1, 2], { a: [3] }])).toBe(6);
  });

  it('counts an object reached twice once, and stops at a cycle', () => {
    const shared = { a: 1, b: 2 };
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic['self'] = cyclic;

    expect(countResultValues({ first: shared, second: shared })).toBe(4);
    expect(countResultValues(cyclic)).toBe(2);
  });

  it('walks a deep value without recursion', () => {
    let deep: Record<string, unknown> = {};
    for (let depth = 0; depth < 50000; depth++) {
      deep = { next: deep };
    }

    expect(countResultValues(deep)).toBe(50000);
  });
});
