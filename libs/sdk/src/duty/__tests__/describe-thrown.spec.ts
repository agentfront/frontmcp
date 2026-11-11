import { describeThrown } from '../describe-thrown';

describe('describeThrown', () => {
  it.each([
    [new Error('disk full'), 'disk full'],
    [new TypeError('not a function'), 'not a function'],
    ['socket closed', 'socket closed'],
    [42, '42'],
    [undefined, 'undefined'],
    [{ code: 'E_LOCKED' }, '[object Object]'],
  ])('describes %p as %p', (thrown, expected) => {
    expect(describeThrown(thrown)).toBe(expected);
  });

  it('falls back to the type tag of a value that has no string form', () => {
    const throwingToString = {
      toString(): string {
        throw new Error('no string form');
      },
    };

    expect(describeThrown(Object.create(null))).toBe('[object Object]');
    expect(describeThrown(throwingToString)).toBe('[object Object]');
  });
});
