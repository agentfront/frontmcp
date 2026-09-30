import { resolveSecurityHeaders } from '../csp.middleware';

const ENV_KEYS = [
  'FRONTMCP_CSP_ENABLED',
  'FRONTMCP_CSP_DIRECTIVES',
  'FRONTMCP_CSP_REPORT_URI',
  'FRONTMCP_CSP_REPORT_ONLY',
  'FRONTMCP_HSTS',
  'FRONTMCP_FRAME_OPTIONS',
  'FRONTMCP_CONTENT_TYPE_OPTIONS',
  'FRONTMCP_HEADERS_CUSTOM',
];

describe('resolveSecurityHeaders', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('sends nosniff and X-Frame-Options DENY by default', () => {
    expect(resolveSecurityHeaders()).toEqual({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
  });

  it('applies FRONTMCP_* env vars', () => {
    process.env['FRONTMCP_HSTS'] = 'max-age=63072000';
    process.env['FRONTMCP_FRAME_OPTIONS'] = 'SAMEORIGIN';
    process.env['FRONTMCP_CSP_ENABLED'] = '1';
    process.env['FRONTMCP_CSP_DIRECTIVES'] = "default-src 'self'; upgrade-insecure-requests";
    process.env['FRONTMCP_CSP_REPORT_ONLY'] = '1';

    const headers = resolveSecurityHeaders();
    expect(headers['Strict-Transport-Security']).toBe('max-age=63072000');
    expect(headers['X-Frame-Options']).toBe('SAMEORIGIN');
    expect(headers['Content-Security-Policy-Report-Only']).toBe("default-src 'self'; upgrade-insecure-requests");
    expect(headers['Content-Security-Policy']).toBeUndefined();
  });

  it('lets explicit options win over env', () => {
    process.env['FRONTMCP_FRAME_OPTIONS'] = 'SAMEORIGIN';
    const headers = resolveSecurityHeaders({ frameOptions: 'DENY', hsts: 'max-age=1' });
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Strict-Transport-Security']).toBe('max-age=1');
  });

  it('disables a header when the option is false', () => {
    const headers = resolveSecurityHeaders({ frameOptions: false, contentTypeOptions: false });
    expect(headers['X-Frame-Options']).toBeUndefined();
    expect(headers['X-Content-Type-Options']).toBeUndefined();
  });

  it('builds CSP from option directives, joining array values', () => {
    const headers = resolveSecurityHeaders({
      csp: {
        enabled: true,
        directives: {
          'default-src': "'self'",
          'script-src': ["'self'", 'https://cdn.example.com'],
          'block-all-mixed-content': '',
        },
        reportUri: 'https://r.example.com/csp',
      },
    });
    expect(headers['Content-Security-Policy']).toBe(
      "default-src 'self'; script-src 'self' https://cdn.example.com; block-all-mixed-content; report-uri https://r.example.com/csp",
    );
  });

  it('adds custom headers', () => {
    const headers = resolveSecurityHeaders({ custom: { 'Referrer-Policy': 'no-referrer' } });
    expect(headers['Referrer-Policy']).toBe('no-referrer');
  });

  it('does not emit CSP when csp.enabled is false even if env enables it', () => {
    process.env['FRONTMCP_CSP_ENABLED'] = '1';
    process.env['FRONTMCP_CSP_DIRECTIVES'] = "default-src 'self'";
    expect(resolveSecurityHeaders({ csp: { enabled: false } })['Content-Security-Policy']).toBeUndefined();
  });
  it.each(['off', 'false', 'none', 'OFF'])(
    'treats %s in a FRONTMCP_* header env var as "omit this header"',
    (value) => {
      process.env['FRONTMCP_FRAME_OPTIONS'] = value;
      process.env['FRONTMCP_CONTENT_TYPE_OPTIONS'] = value;
      process.env['FRONTMCP_HSTS'] = value;
      expect(resolveSecurityHeaders()).toEqual({});
    },
  );

  it('reads custom headers from FRONTMCP_HEADERS_CUSTOM (JSON), merged under explicit custom headers', () => {
    process.env['FRONTMCP_HEADERS_CUSTOM'] = JSON.stringify({ 'Referrer-Policy': 'no-referrer', 'X-A': '1' });
    const headers = resolveSecurityHeaders({ custom: { 'X-A': '2' } });
    expect(headers['Referrer-Policy']).toBe('no-referrer');
    expect(headers['X-A']).toBe('2');
  });

  it('keeps a "__proto__" key from FRONTMCP_HEADERS_CUSTOM as data instead of rewriting a prototype', () => {
    process.env['FRONTMCP_HEADERS_CUSTOM'] = '{"__proto__":"polluted","X-A":"1"}';
    const headers = resolveSecurityHeaders();
    expect(headers['X-A']).toBe('1');
    expect(Object.getPrototypeOf(headers)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('ignores malformed FRONTMCP_HEADERS_CUSTOM', () => {
    process.env['FRONTMCP_HEADERS_CUSTOM'] = '{not json';
    expect(resolveSecurityHeaders()['X-Content-Type-Options']).toBe('nosniff');
  });
});
