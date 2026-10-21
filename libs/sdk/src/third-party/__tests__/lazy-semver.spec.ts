const SEMVER_FUNCTIONS = ['compare', 'gt', 'maxSatisfying', 'rcompare', 'satisfies', 'valid', 'validRange'];

describe('lazy-semver', () => {
  afterEach(() => {
    jest.dontMock('semver/functions/satisfies.js');
    jest.resetModules();
  });

  it('loads a semver function module the first time the function is read', () => {
    const satisfies = jest.fn();
    const loadSatisfies = jest.fn(() => satisfies);
    jest.doMock('semver/functions/satisfies.js', loadSatisfies);

    jest.isolateModules(() => {
      const lazySemver = require('../lazy-semver');
      expect(loadSatisfies).not.toHaveBeenCalled();

      expect(lazySemver.satisfies).toBe(satisfies);
      expect(loadSatisfies).toHaveBeenCalledTimes(1);
    });
  });

  it('exports the functions the eager module exports', () => {
    const lazySemver = require('../lazy-semver');
    const eagerSemver = require('../semver');

    expect(Object.keys(lazySemver).sort()).toEqual(SEMVER_FUNCTIONS);
    for (const name of SEMVER_FUNCTIONS) {
      expect(lazySemver[name]).toBe(eagerSemver[name]);
    }
    expect(lazySemver.satisfies('1.2.3', '^1.0.0')).toBe(true);
  });
});
