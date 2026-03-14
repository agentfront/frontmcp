import {
  satisfiesRange,
  maxSatisfying,
  isValidRange,
  isValidVersion,
  compareVersions,
  isNewerVersion,
} from '../semver.utils';

describe('satisfiesRange', () => {
  it('should return true for matching caret range', () => {
    expect(satisfiesRange('1.2.3', '^1.0.0')).toBe(true);
    expect(satisfiesRange('1.9.9', '^1.0.0')).toBe(true);
  });

  it('should return false for non-matching caret range', () => {
    expect(satisfiesRange('2.0.0', '^1.0.0')).toBe(false);
    expect(satisfiesRange('0.9.9', '^1.0.0')).toBe(false);
  });

  it('should return true for latest', () => {
    expect(satisfiesRange('99.99.99', 'latest')).toBe(true);
  });

  it('should return true for wildcard', () => {
    expect(satisfiesRange('1.0.0', '*')).toBe(true);
  });

  it('should handle tilde ranges', () => {
    expect(satisfiesRange('1.2.5', '~1.2.3')).toBe(true);
    expect(satisfiesRange('1.3.0', '~1.2.3')).toBe(false);
  });

  it('should handle exact versions', () => {
    expect(satisfiesRange('1.2.3', '1.2.3')).toBe(true);
    expect(satisfiesRange('1.2.4', '1.2.3')).toBe(false);
  });
});

describe('maxSatisfying', () => {
  const versions = ['1.0.0', '1.1.0', '1.2.0', '2.0.0', '2.1.0'];

  it('should find the highest matching version', () => {
    expect(maxSatisfying(versions, '^1.0.0')).toBe('1.2.0');
  });

  it('should return the latest for latest tag', () => {
    expect(maxSatisfying(versions, 'latest')).toBe('2.1.0');
  });

  it('should return null when nothing matches', () => {
    expect(maxSatisfying(versions, '^3.0.0')).toBeNull();
  });

  it('should return null for empty array', () => {
    expect(maxSatisfying([], '^1.0.0')).toBeNull();
  });
});

describe('isValidRange', () => {
  it('should return true for valid ranges', () => {
    expect(isValidRange('^1.0.0')).toBe(true);
    expect(isValidRange('~1.2.3')).toBe(true);
    expect(isValidRange('>=1.0.0')).toBe(true);
    expect(isValidRange('latest')).toBe(true);
    expect(isValidRange('*')).toBe(true);
  });

  it('should return false for invalid ranges', () => {
    expect(isValidRange('not-a-range')).toBe(false);
  });
});

describe('isValidVersion', () => {
  it('should return true for valid semver', () => {
    expect(isValidVersion('1.2.3')).toBe(true);
    expect(isValidVersion('0.0.1')).toBe(true);
  });

  it('should return false for invalid semver', () => {
    expect(isValidVersion('not-a-version')).toBe(false);
    expect(isValidVersion('1.2')).toBe(false);
  });
});

describe('compareVersions', () => {
  it('should compare versions correctly', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });
});

describe('isNewerVersion', () => {
  it('should detect newer versions', () => {
    expect(isNewerVersion('2.0.0', '1.0.0')).toBe(true);
    expect(isNewerVersion('1.0.0', '2.0.0')).toBe(false);
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
  });
});
