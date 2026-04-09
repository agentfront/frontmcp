import {
  applySecurityHeaders,
  buildCspHeaderValue,
  getCspHeaderName,
  readCspFromEnv,
  type CspOptions,
  type SecurityHeaders,
} from '../csp.middleware';

describe('buildCspHeaderValue', () => {
  it('should build CSP from directives', () => {
    const csp: CspOptions = {
      enabled: true,
      directives: { 'default-src': "'self'", 'script-src': "'self' https://cdn.example.com" },
      reportOnly: false,
    };
    expect(buildCspHeaderValue(csp)).toBe("default-src 'self'; script-src 'self' https://cdn.example.com");
  });

  it('should include report-uri when set', () => {
    const csp: CspOptions = {
      enabled: true,
      directives: { 'default-src': "'self'" },
      reportUri: 'https://report.example.com/csp',
      reportOnly: false,
    };
    expect(buildCspHeaderValue(csp)).toContain('report-uri https://report.example.com/csp');
  });

  it('should return empty string for empty directives', () => {
    const csp: CspOptions = { enabled: true, directives: {}, reportOnly: false };
    expect(buildCspHeaderValue(csp)).toBe('');
  });
});

describe('getCspHeaderName', () => {
  it('should return enforcement header', () => {
    expect(getCspHeaderName(false)).toBe('Content-Security-Policy');
  });

  it('should return report-only header', () => {
    expect(getCspHeaderName(true)).toBe('Content-Security-Policy-Report-Only');
  });
});

describe('applySecurityHeaders', () => {
  function createMockRes() {
    const headers: Record<string, string> = {};
    return {
      headers,
      setHeader: jest.fn((name: string, value: string) => {
        headers[name] = value;
      }),
    };
  }

  it('should apply HSTS when set', () => {
    const res = createMockRes();
    applySecurityHeaders(res, { hsts: 'max-age=31536000' });
    expect(res.headers['Strict-Transport-Security']).toBe('max-age=31536000');
  });

  it('should apply X-Content-Type-Options', () => {
    const res = createMockRes();
    applySecurityHeaders(res, { contentTypeOptions: 'nosniff' });
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('should apply X-Frame-Options', () => {
    const res = createMockRes();
    applySecurityHeaders(res, { frameOptions: 'DENY' });
    expect(res.headers['X-Frame-Options']).toBe('DENY');
  });

  it('should apply custom headers', () => {
    const res = createMockRes();
    applySecurityHeaders(res, { custom: { 'X-Custom': 'value' } });
    expect(res.headers['X-Custom']).toBe('value');
  });

  it('should apply CSP header', () => {
    const res = createMockRes();
    const csp: CspOptions = {
      enabled: true,
      directives: { 'default-src': "'self'" },
      reportOnly: false,
    };
    applySecurityHeaders(res, {}, csp);
    expect(res.headers['Content-Security-Policy']).toBe("default-src 'self'");
  });

  it('should use Report-Only header when reportOnly is true', () => {
    const res = createMockRes();
    const csp: CspOptions = {
      enabled: true,
      directives: { 'default-src': "'self'" },
      reportOnly: true,
    };
    applySecurityHeaders(res, {}, csp);
    expect(res.headers['Content-Security-Policy-Report-Only']).toBe("default-src 'self'");
    expect(res.headers['Content-Security-Policy']).toBeUndefined();
  });

  it('should skip headers that are undefined', () => {
    const res = createMockRes();
    applySecurityHeaders(res, {});
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('should skip CSP when not enabled', () => {
    const res = createMockRes();
    applySecurityHeaders(res, {}, undefined);
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('should combine all headers', () => {
    const res = createMockRes();
    const headers: SecurityHeaders = {
      hsts: 'max-age=31536000; includeSubDomains',
      contentTypeOptions: 'nosniff',
      frameOptions: 'DENY',
    };
    const csp: CspOptions = {
      enabled: true,
      directives: { 'default-src': "'self'" },
      reportOnly: false,
    };
    applySecurityHeaders(res, headers, csp);
    expect(res.setHeader).toHaveBeenCalledTimes(4);
  });
});

describe('readCspFromEnv', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should return undefined when CSP not enabled', () => {
    delete process.env['FRONTMCP_CSP_ENABLED'];
    expect(readCspFromEnv()).toBeUndefined();
  });

  it('should parse directives without values', () => {
    process.env['FRONTMCP_CSP_ENABLED'] = '1';
    process.env['FRONTMCP_CSP_DIRECTIVES'] = "default-src 'self'; upgrade-insecure-requests";

    const csp = readCspFromEnv();
    expect(csp).toBeDefined();
    expect(csp!.directives['default-src']).toBe("'self'");
    expect(csp!.directives['upgrade-insecure-requests']).toBe('');

    const header = buildCspHeaderValue(csp!);
    expect(header).toBe("default-src 'self'; upgrade-insecure-requests");
  });

  it('should parse CSP from env vars', () => {
    process.env['FRONTMCP_CSP_ENABLED'] = '1';
    process.env['FRONTMCP_CSP_DIRECTIVES'] = "default-src 'self'; script-src 'self' https://cdn.example.com";
    process.env['FRONTMCP_CSP_REPORT_URI'] = 'https://report.example.com';
    process.env['FRONTMCP_CSP_REPORT_ONLY'] = '1';

    const csp = readCspFromEnv();
    expect(csp).toBeDefined();
    expect(csp!.enabled).toBe(true);
    expect(csp!.directives['default-src']).toBe("'self'");
    expect(csp!.directives['script-src']).toBe("'self' https://cdn.example.com");
    expect(csp!.reportUri).toBe('https://report.example.com');
    expect(csp!.reportOnly).toBe(true);
  });
});
