import { pickServerDefaults, securityHeadersEnv, securityHeadersEnvSetupLines } from '../security-headers-env';

describe('securityHeadersEnv', () => {
  it('returns an empty object when nothing is configured', () => {
    expect(securityHeadersEnv(undefined)).toEqual({});
    expect(securityHeadersEnv({})).toEqual({});
  });

  it('maps server.headers to FRONTMCP_* variables', () => {
    expect(
      securityHeadersEnv({
        headers: {
          hsts: 'max-age=31536000',
          contentTypeOptions: 'nosniff',
          frameOptions: 'SAMEORIGIN',
          custom: { 'Referrer-Policy': 'no-referrer' },
        },
      }),
    ).toEqual({
      FRONTMCP_HSTS: 'max-age=31536000',
      FRONTMCP_CONTENT_TYPE_OPTIONS: 'nosniff',
      FRONTMCP_FRAME_OPTIONS: 'SAMEORIGIN',
      FRONTMCP_HEADERS_CUSTOM: JSON.stringify({ 'Referrer-Policy': 'no-referrer' }),
    });
  });

  it('encodes `false` as "off" so a header can be disabled', () => {
    expect(securityHeadersEnv({ headers: { hsts: false, frameOptions: false } })).toEqual({
      FRONTMCP_HSTS: 'off',
      FRONTMCP_FRAME_OPTIONS: 'off',
    });
  });

  it('maps server.csp, joining directives and array values', () => {
    expect(
      securityHeadersEnv({
        csp: {
          enabled: true,
          directives: { 'default-src': ["'self'"], 'img-src': ["'self'", 'data:'], 'frame-ancestors': "'none'" },
          reportUri: '/csp-report',
          reportOnly: true,
        },
      }),
    ).toEqual({
      FRONTMCP_CSP_ENABLED: 'true',
      FRONTMCP_CSP_DIRECTIVES: "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
      FRONTMCP_CSP_REPORT_URI: '/csp-report',
      FRONTMCP_CSP_REPORT_ONLY: 'true',
    });
  });

  it('renders setup lines that only fill in unset variables', () => {
    const lines = securityHeadersEnvSetupLines({ FRONTMCP_HSTS: 'max-age=1', FRONTMCP_HEADERS_CUSTOM: '{"A":"b\'c"}' });
    expect(lines).toContain('if (process.env.FRONTMCP_HSTS === undefined) process.env.FRONTMCP_HSTS = "max-age=1";');
    expect(lines).toContain('FRONTMCP_HEADERS_CUSTOM');
    expect(securityHeadersEnvSetupLines({})).toBe('');
  });
});

describe('pickServerDefaults', () => {
  it('returns the first deployment that declares a server block', () => {
    const server = { headers: { hsts: 'x' } };
    expect(
      pickServerDefaults({
        deployments: [{ target: 'cli' }, { target: 'node', server }, { target: 'vercel', server: {} }],
      } as never),
    ).toBe(server);
  });

  it('returns undefined without a config or server block', () => {
    expect(pickServerDefaults(undefined)).toBeUndefined();
    expect(pickServerDefaults({ deployments: [{ target: 'cli' }] } as never)).toBeUndefined();
  });
});
