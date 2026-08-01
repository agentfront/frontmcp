import { validateAuthorizationIssuer } from '../instances/instance.local-primary-auth';

describe('validateAuthorizationIssuer (RFC 9207 / SEP-2468)', () => {
  it('accepts a matching issuer', () => {
    expect(validateAuthorizationIssuer('https://idp.example.com', 'https://idp.example.com')).toEqual({ ok: true });
  });

  it('normalizes a trailing slash on either side', () => {
    // `https://idp.example.com` and `https://idp.example.com/` denote the same
    // issuer; rejecting on that difference would break conforming servers.
    expect(validateAuthorizationIssuer('https://idp.example.com/', 'https://idp.example.com')).toEqual({ ok: true });
    expect(validateAuthorizationIssuer('https://idp.example.com', 'https://idp.example.com/')).toEqual({ ok: true });
  });

  it('rejects a different issuer', () => {
    const result = validateAuthorizationIssuer('https://evil.example.com', 'https://idp.example.com');
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain('does not match');
  });

  it('rejects a same-host issuer on a different path', () => {
    const result = validateAuthorizationIssuer('https://idp.example.com/tenant-b', 'https://idp.example.com/tenant-a');
    expect(result.ok).toBe(false);
  });

  it('accepts an absent iss — the parameter is only SHOULD-sent', () => {
    // Rejecting would break every authorization server that has not adopted
    // RFC 9207 yet, which is not what the spec asks for.
    expect(validateAuthorizationIssuer(undefined, 'https://idp.example.com')).toEqual({ ok: true });
  });

  it('accepts any iss when no issuer was recorded for the provider', () => {
    expect(validateAuthorizationIssuer('https://idp.example.com', undefined)).toEqual({ ok: true });
    expect(validateAuthorizationIssuer('https://idp.example.com', '')).toEqual({ ok: true });
  });

  it('rejects an empty-string iss against a configured issuer', () => {
    const result = validateAuthorizationIssuer('', 'https://idp.example.com');
    expect(result.ok).toBe(false);
  });
});
