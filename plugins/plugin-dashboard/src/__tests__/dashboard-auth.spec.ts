/**
 * Dashboard token check (GHSA-rgxj-434m-vxh3).
 *
 * The option was documented and validated but never read. These cases pin the
 * contract it should always have had: fail closed when enabled, accept the token
 * from either the header or the query, and compare it in constant time.
 */
import {
  createDashboardAuthValidator,
  DASHBOARD_SESSION_COOKIE,
  DASHBOARD_TOKEN_HEADER,
  deriveDashboardCookieValue,
} from '../auth/dashboard-auth';

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

    it('accepts the bearer scheme in any casing (RFC 7235 makes it case-insensitive)', () => {
      expect(authorize({ headers: { authorization: `bearer ${TOKEN}` } }).authorized).toBe(true);
      expect(authorize({ headers: { authorization: `BEARER ${TOKEN}` } }).authorized).toBe(true);
    });

    it('tolerates extra whitespace between the scheme and the token', () => {
      expect(authorize({ headers: { authorization: `Bearer   ${TOKEN}` } }).authorized).toBe(true);
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

describe('createDashboardAuthValidator for the MCP endpoint', () => {
  const authorize = createDashboardAuthValidator({ enabled: true, token: TOKEN }, 'mcp')!;
  const cookie = `${DASHBOARD_SESSION_COOKIE}=${deriveDashboardCookieValue(TOKEN)}`;

  it('accepts the token in the x-frontmcp-dashboard-token header', () => {
    expect(authorize({ headers: { [DASHBOARD_TOKEN_HEADER]: TOKEN } }).authorized).toBe(true);
  });

  it('accepts a bearer header', () => {
    expect(authorize({ headers: { authorization: `Bearer ${TOKEN}` } }).authorized).toBe(true);
  });

  it('accepts the session cookie the page sets, among other cookies', () => {
    expect(authorize({ headers: { cookie: `theme=dark; ${cookie}; other=1` } }).authorized).toBe(true);
  });

  it('does not accept ?token= (a URL token lands in logs and Referer headers)', () => {
    expect(authorize({ query: { token: TOKEN } }).authorized).toBe(false);
  });

  it('does not accept the raw token as the cookie', () => {
    expect(authorize({ headers: { cookie: `${DASHBOARD_SESSION_COOKIE}=${TOKEN}` } }).authorized).toBe(false);
  });

  it('ignores malformed cookie pairs and other cookie names', () => {
    expect(authorize({ headers: { cookie: `broken; x=${deriveDashboardCookieValue(TOKEN)}` } }).authorized).toBe(false);
  });

  it('refuses a wrong header token', () => {
    expect(authorize({ headers: { [DASHBOARD_TOKEN_HEADER]: 'wrong' } }).authorized).toBe(false);
  });
});

describe('the page surface', () => {
  const authorize = createDashboardAuthValidator({ enabled: true, token: TOKEN })!;

  it('accepts the session cookie, so a reload needs no token in the URL', () => {
    const cookie = `${DASHBOARD_SESSION_COOKIE}=${deriveDashboardCookieValue(TOKEN)}`;
    expect(authorize({ headers: { cookie } }).authorized).toBe(true);
  });

  it('does not take the MCP header (the page link uses ?token= or a bearer)', () => {
    expect(authorize({ headers: { [DASHBOARD_TOKEN_HEADER]: TOKEN } }).authorized).toBe(false);
  });
});

describe('deriveDashboardCookieValue', () => {
  it('is stable for a token and never contains it', () => {
    expect(deriveDashboardCookieValue(TOKEN)).toBe(deriveDashboardCookieValue(TOKEN));
    expect(deriveDashboardCookieValue(TOKEN)).not.toContain(TOKEN);
    expect(deriveDashboardCookieValue(TOKEN)).not.toBe(deriveDashboardCookieValue(`${TOKEN}x`));
  });
});
