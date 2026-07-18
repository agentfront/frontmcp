import type { ServerRequest } from '../../interfaces';
import { computeIssuer, getRequestBaseUrl, normalizeResourceUri, resourceUriMatches } from '../path.utils';

const mkReq = (headers: Record<string, string>): ServerRequest => ({ headers }) as unknown as ServerRequest;

describe('getRequestBaseUrl — FRONTMCP_PUBLIC_URL pin + trust-proxy gating (SECURITY-REVIEW A4)', () => {
  const ORIGINAL_PIN = process.env['FRONTMCP_PUBLIC_URL'];
  const ORIGINAL_TRUST = process.env['FRONTMCP_TRUST_PROXY'];
  afterEach(() => {
    if (ORIGINAL_PIN === undefined) delete process.env['FRONTMCP_PUBLIC_URL'];
    else process.env['FRONTMCP_PUBLIC_URL'] = ORIGINAL_PIN;
    if (ORIGINAL_TRUST === undefined) delete process.env['FRONTMCP_TRUST_PROXY'];
    else process.env['FRONTMCP_TRUST_PROXY'] = ORIGINAL_TRUST;
  });

  it('IGNORES X-Forwarded-* by default and uses the direct Host (secure default)', () => {
    delete process.env['FRONTMCP_PUBLIC_URL'];
    delete process.env['FRONTMCP_TRUST_PROXY'];
    // Attacker-supplied forwarded headers must NOT influence derivation.
    const url = getRequestBaseUrl(
      mkReq({ host: 'real.example.com', 'x-forwarded-host': 'evil.attacker.com', 'x-forwarded-proto': 'https' }),
    );
    expect(url).toBe('http://real.example.com');
  });

  it('honors X-Forwarded-* only when FRONTMCP_TRUST_PROXY is enabled', () => {
    delete process.env['FRONTMCP_PUBLIC_URL'];
    process.env['FRONTMCP_TRUST_PROXY'] = '1';
    const url = getRequestBaseUrl(
      mkReq({ host: 'internal:3000', 'x-forwarded-host': 'mcp.example.com', 'x-forwarded-proto': 'https' }),
    );
    expect(url).toBe('https://mcp.example.com');
  });

  it('ignores attacker-controlled X-Forwarded-Host even when FRONTMCP_TRUST_PROXY is enabled, if the pin is set', () => {
    process.env['FRONTMCP_PUBLIC_URL'] = 'https://mcp.example.com';
    process.env['FRONTMCP_TRUST_PROXY'] = '1';
    const url = getRequestBaseUrl(
      mkReq({ host: 'real.example.com', 'x-forwarded-host': 'evil.attacker.com', 'x-forwarded-proto': 'http' }),
    );
    expect(url).toBe('https://mcp.example.com');
  });

  it('pins the issuer regardless of forwarded headers', () => {
    process.env['FRONTMCP_PUBLIC_URL'] = 'https://mcp.example.com/';
    const issuer = computeIssuer(mkReq({ 'x-forwarded-host': 'evil.attacker.com' }), '/mcp', 'app1');
    expect(issuer).toBe('https://mcp.example.com/mcp/app1');
  });

  it('appends entryPath to the pinned origin', () => {
    process.env['FRONTMCP_PUBLIC_URL'] = 'https://mcp.example.com';
    expect(getRequestBaseUrl(mkReq({ host: 'evil.com' }), '/mcp')).toBe('https://mcp.example.com/mcp');
  });
});

describe('normalizeResourceUri', () => {
  it('should return same URI if already normalized', () => {
    expect(normalizeResourceUri('https://api.example.com/mcp')).toBe('https://api.example.com/mcp');
  });

  it('should strip trailing slash', () => {
    expect(normalizeResourceUri('https://api.example.com/mcp/')).toBe('https://api.example.com/mcp');
  });

  it('should preserve root path', () => {
    expect(normalizeResourceUri('https://api.example.com/')).toBe('https://api.example.com/');
  });

  it('should strip default HTTPS port', () => {
    expect(normalizeResourceUri('https://api.example.com:443/mcp')).toBe('https://api.example.com/mcp');
  });

  it('should strip default HTTP port', () => {
    expect(normalizeResourceUri('http://api.example.com:80/mcp')).toBe('http://api.example.com/mcp');
  });

  it('should keep non-default port', () => {
    expect(normalizeResourceUri('https://api.example.com:8443/mcp')).toBe('https://api.example.com:8443/mcp');
  });

  it('should lowercase scheme and host', () => {
    expect(normalizeResourceUri('HTTPS://API.EXAMPLE.COM/mcp')).toBe('https://api.example.com/mcp');
  });

  it('should resolve path dots', () => {
    expect(normalizeResourceUri('https://api.example.com/a/../b')).toBe('https://api.example.com/b');
  });

  it('should strip fragment', () => {
    expect(normalizeResourceUri('https://api.example.com/mcp#frag')).toBe('https://api.example.com/mcp');
  });

  it('should strip query string', () => {
    expect(normalizeResourceUri('https://api.example.com/mcp?q=1')).toBe('https://api.example.com/mcp');
  });

  it('should strip both query and fragment', () => {
    expect(normalizeResourceUri('https://api.example.com/mcp?q=1#frag')).toBe('https://api.example.com/mcp');
  });

  it('should return invalid URI as-is', () => {
    expect(normalizeResourceUri('not a url')).toBe('not a url');
  });
});

describe('resourceUriMatches', () => {
  it('should match identical URIs', () => {
    expect(resourceUriMatches('https://api.example.com/mcp', 'https://api.example.com/mcp')).toBe(true);
  });

  it('should match with trailing slash difference', () => {
    expect(resourceUriMatches('https://api.example.com/mcp/', 'https://api.example.com/mcp')).toBe(true);
  });

  it('should match with default port difference', () => {
    expect(resourceUriMatches('https://api.example.com:443/mcp', 'https://api.example.com/mcp')).toBe(true);
  });

  it('should not match different non-default ports', () => {
    expect(resourceUriMatches('https://api.example.com:8443/mcp', 'https://api.example.com/mcp')).toBe(false);
  });

  it('should match case-insensitive host', () => {
    expect(resourceUriMatches('HTTPS://API.EXAMPLE.COM/mcp', 'https://api.example.com/mcp')).toBe(true);
  });

  it('should match with path dots', () => {
    expect(resourceUriMatches('https://api.example.com/a/../b', 'https://api.example.com/b')).toBe(true);
  });

  it('should match ignoring fragment', () => {
    expect(resourceUriMatches('https://api.example.com/mcp#frag', 'https://api.example.com/mcp')).toBe(true);
  });

  it('should match ignoring query', () => {
    expect(resourceUriMatches('https://api.example.com/mcp?q=1', 'https://api.example.com/mcp')).toBe(true);
  });

  it('should not match different paths', () => {
    expect(resourceUriMatches('https://api.example.com/other', 'https://api.example.com/mcp')).toBe(false);
  });

  it('should not match different hosts', () => {
    expect(resourceUriMatches('https://evil.com/mcp', 'https://api.example.com/mcp')).toBe(false);
  });

  it('should not match different schemes', () => {
    expect(resourceUriMatches('http://api.example.com/mcp', 'https://api.example.com/mcp')).toBe(false);
  });
});
