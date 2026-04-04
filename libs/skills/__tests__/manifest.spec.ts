/**
 * Skills manifest validation tests.
 */

import { VALID_TARGETS, VALID_CATEGORIES, VALID_BUNDLES } from '../src/manifest';

describe('manifest constants', () => {
  it('should export valid targets', () => {
    expect(VALID_TARGETS).toContain('node');
    expect(VALID_TARGETS).toContain('vercel');
    expect(VALID_TARGETS).toContain('lambda');
    expect(VALID_TARGETS).toContain('cloudflare');
    expect(VALID_TARGETS).toContain('all');
    expect(VALID_TARGETS).toHaveLength(5);
  });

  it('should export valid categories', () => {
    expect(VALID_CATEGORIES).toContain('setup');
    expect(VALID_CATEGORIES).toContain('deployment');
    expect(VALID_CATEGORIES).toContain('development');
    expect(VALID_CATEGORIES).toContain('config');
    expect(VALID_CATEGORIES).toContain('testing');
    expect(VALID_CATEGORIES).toContain('guides');
    expect(VALID_CATEGORIES).toContain('production');
    expect(VALID_CATEGORIES).toContain('extensibility');
    expect(VALID_CATEGORIES).toContain('observability');
    expect(VALID_CATEGORIES).toHaveLength(9);
  });

  it('should export valid bundles', () => {
    expect(VALID_BUNDLES).toContain('recommended');
    expect(VALID_BUNDLES).toContain('minimal');
    expect(VALID_BUNDLES).toContain('full');
    expect(VALID_BUNDLES).toHaveLength(3);
  });
});
