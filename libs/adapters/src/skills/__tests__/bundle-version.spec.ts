import { compareBundleVersions } from '../bundle/bundle-version';

const EARLIER = '2026-11-04T10:00:00.000Z';
const LATER = '2026-11-04T12:00:00.000Z';

/** -1, 0 or 1: whether the first bundle is older than, as old as, or newer than the second. */
function order(version: string, generatedAt: string, otherVersion: string, otherGeneratedAt: string): number {
  return Math.sign(
    compareBundleVersions({ version, generatedAt }, { version: otherVersion, generatedAt: otherGeneratedAt }),
  );
}

describe('compareBundleVersions', () => {
  it('orders two semver versions by semver precedence, whatever their generatedAt', () => {
    expect(order('2.0.0', EARLIER, '1.9.9', LATER)).toBe(1);
    expect(order('1.9.9', LATER, '2.0.0', EARLIER)).toBe(-1);
    expect(order('1.10.0', EARLIER, '1.9.0', EARLIER)).toBe(1);
    expect(order('2.0.0-rc.1', LATER, '2.0.0', EARLIER)).toBe(-1);
  });

  it('orders the same version, re-signed, by generatedAt', () => {
    expect(order('2.0.0', LATER, '2.0.0', EARLIER)).toBe(1);
    expect(order('2.0.0', EARLIER, '2.0.0', LATER)).toBe(-1);
    expect(order('2.0.0+build.2', EARLIER, '2.0.0+build.1', LATER)).toBe(-1);
  });

  it('finds neither older for the same version and generatedAt', () => {
    expect(order('2.0.0', LATER, '2.0.0', LATER)).toBe(0);
    expect(order('7', LATER, '7', LATER)).toBe(0);
  });

  it('orders versions that are not both semver by generatedAt alone', () => {
    expect(order('9', LATER, '10', EARLIER)).toBe(1);
    expect(order('10', EARLIER, '9', LATER)).toBe(-1);
    expect(order('2026.05.01-1', EARLIER, '1.0.0', LATER)).toBe(-1);
    expect(order('build-2', LATER, 'build-1', LATER)).toBe(0);
  });

  it('returns NaN when the order falls to a generatedAt that is not a date', () => {
    expect(order('2.0.0', 'not-a-date', '2.0.0', LATER)).toBeNaN();
    expect(order('9', LATER, '10', 'not-a-date')).toBeNaN();
    expect(order('2.0.0', 'not-a-date', '1.0.0', LATER)).toBe(1);
  });
});
