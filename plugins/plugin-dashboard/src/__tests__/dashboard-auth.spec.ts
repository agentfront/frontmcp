/**
 * Dashboard token check (GHSA-rgxj-434m-vxh3).
 *
 * The option was documented and validated but never read. These cases pin the
 * contract it should always have had: fail closed when enabled, accept the token
 * from either the header or the query, and compare it in constant time.
 */
import { createDashboardAuthValidator } from '../auth/dashboard-auth';

const TOKEN = 'super-secret-dash-token';

describe('createDashboardAuthValidator', () => {
  it('returns undefined when auth is not enabled, so the caller skips the check', () => {
    expect(createDashboardAuthValidator(undefined)).toBeUndefined();
    expect(createDashboardAuthValidator({ enabled: false })).toBeUndefined();
    expect(createDashboardAuthValidator({ enabled: false, token: TOKEN })).toBeUndefined();
  });

  it('is created when auth is enabled', () => {
    expect(createDashboardAuthValidator({ enabled: true, token: TOKEN })).toBeDefined();
  });

  describe('with a configured token', () => {
    const authorize = createDashboardAuthValidator({ enabled: true, token: TOKEN })!;

    it('accepts a bearer header', () => {
      expect(authorize({ headers: { authorization: `Bearer ${TOKEN}` } })).toEqual({ authorized: true });
    });

    it('accepts the header regardless of its casing', () => {
      expect(authorize({ headers: { Authorization: `Bearer ${TOKEN}` } }).authorized).toBe(true);
    });

    it('accepts a query parameter, which is what the documented link uses', () => {
      expect(authorize({ query: { token: TOKEN } }).authorized).toBe(true);
    });

    it('takes the first value of a repeated query parameter', () => {
      expect(authorize({ query: { token: [TOKEN, 'other'] } }).authorized).toBe(true);
    });

    it('refuses a request carrying no credential at all', () => {
      expect(authorize({})).toEqual({ authorized: false, status: 401, message: 'Unauthorized' });
    });

    it('refuses a wrong token', () => {
      expect(authorize({ query: { token: 'wrong' } }).authorized).toBe(false);
      expect(authorize({ headers: { authorization: 'Bearer wrong' } }).authorized).toBe(false);
    });

    it('refuses a token of a different length (no timingSafeEqual throw)', () => {
      // Both sides are hashed before the constant-time compare, so a
      // length mismatch is a plain refusal rather than an exception.
      expect(() => authorize({ query: { token: 'x' } })).not.toThrow();
      expect(authorize({ query: { token: 'x' } }).authorized).toBe(false);
    });

    it('refuses an empty token', () => {
      expect(authorize({ query: { token: '' } }).authorized).toBe(false);
    });

    it('refuses a non-bearer Authorization scheme', () => {
      expect(authorize({ headers: { authorization: `Basic ${TOKEN}` } }).authorized).toBe(false);
    });
  });

  it('fails closed when enabled without a token', () => {
    // The schema refuses this configuration, so reaching here means a bug —
    // serve nothing rather than serve everything.
    const authorize = createDashboardAuthValidator({ enabled: true } as never)!;
    expect(authorize({ query: { token: 'anything' } }).authorized).toBe(false);
    expect(authorize({}).authorized).toBe(false);
  });
});
