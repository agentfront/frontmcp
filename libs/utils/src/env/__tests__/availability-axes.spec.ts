/**
 * EntryAvailability matcher tests for the new axes (issue #417).
 *
 * Covers `os` / `provider` / `target` / `surface` axes added to the
 * EntryAvailability schema, plus the back-compat `platform` alias.
 */

import { checkEntryAvailability, isEntryAvailable, type RuntimeContext } from '../runtime-context';

function makeCtx(overrides: Partial<RuntimeContext> = {}): RuntimeContext {
  return {
    os: 'linux',
    platform: 'linux',
    runtime: 'node',
    deployment: 'standalone',
    provider: 'bare',
    target: 'node',
    env: 'development',
    ...overrides,
  };
}

describe('EntryAvailability with #417 axes', () => {
  describe('isEntryAvailable', () => {
    it('returns true when undefined (always available)', () => {
      expect(isEntryAvailable(undefined, makeCtx())).toBe(true);
    });

    it('matches on the new `os` axis', () => {
      const ctx = makeCtx({ os: 'darwin', platform: 'darwin' });
      expect(isEntryAvailable({ os: ['darwin'] }, ctx)).toBe(true);
      expect(isEntryAvailable({ os: ['linux'] }, ctx)).toBe(false);
    });

    it('treats `platform` as a back-compat alias matching the same value', () => {
      const ctx = makeCtx({ os: 'darwin', platform: 'darwin' });
      expect(isEntryAvailable({ platform: ['darwin'] }, ctx)).toBe(true);
      expect(isEntryAvailable({ platform: ['linux'] }, ctx)).toBe(false);
    });

    it('AND across os + platform (both must match — same value)', () => {
      const ctx = makeCtx({ os: 'linux', platform: 'linux' });
      expect(isEntryAvailable({ os: ['linux'], platform: ['linux'] }, ctx)).toBe(true);
      expect(isEntryAvailable({ os: ['linux'], platform: ['darwin'] }, ctx)).toBe(false);
    });

    it('matches on `provider`', () => {
      const ctx = makeCtx({ provider: 'vercel' });
      expect(isEntryAvailable({ provider: ['vercel'] }, ctx)).toBe(true);
      expect(isEntryAvailable({ provider: ['vercel', 'lambda'] }, ctx)).toBe(true);
      expect(isEntryAvailable({ provider: ['lambda'] }, ctx)).toBe(false);
    });

    it('matches on `target`', () => {
      const ctx = makeCtx({ target: 'cli' });
      expect(isEntryAvailable({ target: ['cli'] }, ctx)).toBe(true);
      expect(isEntryAvailable({ target: ['node'] }, ctx)).toBe(false);
    });

    it('matches on `surface` only when the caller tagged it', () => {
      const ctx = makeCtx();
      // No callCtx → surface axis is unenforced (registry-level paths)
      expect(isEntryAvailable({ surface: ['mcp'] }, ctx)).toBe(true);
      // With callCtx → surface gate applies
      expect(isEntryAvailable({ surface: ['mcp'] }, ctx, { surface: 'mcp' })).toBe(true);
      expect(isEntryAvailable({ surface: ['mcp'] }, ctx, { surface: 'cli' })).toBe(false);
    });

    it('empty `surface` array → never available', () => {
      const ctx = makeCtx();
      expect(isEntryAvailable({ surface: [] }, ctx)).toBe(false);
      expect(isEntryAvailable({ surface: [] }, ctx, { surface: 'mcp' })).toBe(false);
    });

    it('AND across all six axes', () => {
      const ctx = makeCtx({ os: 'linux', provider: 'vercel', target: 'vercel', runtime: 'node' });
      const constraint = {
        os: ['linux'],
        runtime: ['node'],
        provider: ['vercel'],
        target: ['vercel'],
        surface: ['mcp' as const],
      };
      expect(isEntryAvailable(constraint, ctx, { surface: 'mcp' })).toBe(true);
      // Flip any axis → fail
      expect(isEntryAvailable({ ...constraint, os: ['darwin'] }, ctx, { surface: 'mcp' })).toBe(false);
      expect(isEntryAvailable({ ...constraint, target: ['cli'] }, ctx, { surface: 'mcp' })).toBe(false);
    });
  });

  describe('checkEntryAvailability — missingAxes shape', () => {
    it('returns no missing axes when constraint matches', () => {
      const result = checkEntryAvailability({ os: ['linux'] }, makeCtx());
      expect(result).toEqual({ available: true, missingAxes: [] });
    });

    it('returns the failing axis name when one constraint fails', () => {
      const result = checkEntryAvailability({ os: ['darwin'] }, makeCtx({ os: 'linux', platform: 'linux' }));
      expect(result.available).toBe(false);
      expect(result.missingAxes).toEqual(['os']);
    });

    it('returns multiple axes when several fail', () => {
      const ctx = makeCtx({ os: 'linux', provider: 'bare', target: 'node' });
      const result = checkEntryAvailability({ os: ['darwin'], provider: ['vercel'], target: ['cli'] }, ctx);
      expect(result.available).toBe(false);
      expect(result.missingAxes.sort()).toEqual(['os', 'provider', 'target']);
    });

    it("includes 'surface' in missingAxes when surface gate fails", () => {
      const ctx = makeCtx();
      const result = checkEntryAvailability({ surface: ['mcp'] }, ctx, { surface: 'cli' });
      expect(result.available).toBe(false);
      expect(result.missingAxes).toContain('surface');
    });
  });
});
