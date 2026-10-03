import { base64urlEncode } from '@frontmcp/utils';

import { callerTokenOf, callerTokenRefusal } from '../executor/caller-token';

const BASE_URL = 'https://api.acme.com/v1';

/** An (unsigned) JWT with these claims. */
const jwtWith = (claims: Record<string, unknown>): string => {
  const part = (value: unknown) => base64urlEncode(new TextEncoder().encode(JSON.stringify(value)));
  return `${part({ alg: 'none', typ: 'JWT' })}.${part(claims)}.sig`;
};

describe('callerTokenOf', () => {
  it("reads the caller's token from authInfo", () => {
    expect(callerTokenOf({ token: 'abc' })).toBe('abc');
  });

  it.each([
    ['no authInfo', undefined],
    ['a null authInfo', null],
    ['a non-object authInfo', 'abc'],
    ['no token', {}],
    ['an empty token', { token: '' }],
    ['a non-string token', { token: 42 }],
  ])('has no token for %s', (_case, authInfo) => {
    expect(callerTokenOf(authInfo)).toBeUndefined();
  });
});

describe('callerTokenRefusal', () => {
  it.each([
    ['the exact base URL in resource', { resource: BASE_URL }],
    ['the base URL in a resource list', { resource: ['https://other.example.com', BASE_URL] }],
    ['the origin in aud', { aud: 'https://api.acme.com' }],
    ['a parent path in aud', { aud: ['https://api.acme.com/'] }],
  ])('allows a token naming the API by %s', (_case, claims) => {
    expect(callerTokenRefusal(jwtWith(claims), BASE_URL)).toBeUndefined();
  });

  it.each([
    ['another origin', { resource: 'https://evil.example.com/v1' }],
    ['another port', { resource: 'https://api.acme.com:8443/v1' }],
    ['another scheme', { resource: 'http://api.acme.com/v1' }],
    ['a sibling path', { resource: 'https://api.acme.com/v10' }],
    ['a narrower path', { resource: 'https://api.acme.com/v1/invoices' }],
    ['a resource with a query', { resource: 'https://api.acme.com/v1?tenant=a' }],
    ['a resource with a fragment', { resource: 'https://api.acme.com/v1#x' }],
    ['a non-URL resource', { resource: 'billing-api' }],
    ['non-string claim values', { resource: [42, { url: BASE_URL }], aud: true }],
    ['no resource or aud', { sub: 'u1' }],
  ])('refuses a token naming %s', (_case, claims) => {
    expect(callerTokenRefusal(jwtWith(claims), BASE_URL)).toMatch(/was not issued for https:\/\/api\.acme\.com\/v1/);
  });

  it('refuses a token that is not a JWT', () => {
    expect(callerTokenRefusal('opaque-token', BASE_URL)).toMatch(/not a JWT/);
  });

  it('refuses when the service base URL is not a URL', () => {
    expect(callerTokenRefusal(jwtWith({ resource: BASE_URL }), 'not a url')).toMatch(/was not issued for/);
  });
});

describe('callerTokenRefusal for the URL a request goes to', () => {
  const token = jwtWith({ resource: BASE_URL });

  it.each([
    ['an operation path', 'https://api.acme.com/v1/invoices/42'],
    ['an encoded slash inside a segment', 'https://api.acme.com/v1/files/a%2Fb'],
    ['a "." segment', 'https://api.acme.com/v1/./me'],
    ['dots inside a segment', 'https://api.acme.com/v1/inv...1/me'],
    ['".." in the query only', 'https://api.acme.com/v1/search?path=../../admin'],
  ])('allows %s under the resource', (_case, url) => {
    expect(callerTokenRefusal(token, url)).toBeUndefined();
  });

  it.each([
    ['a ".." segment', 'https://api.acme.com/v1/../admin'],
    ['a "%2e%2e" segment', 'https://api.acme.com/v1/%2e%2e/admin'],
    ['a ".%2E" segment', 'https://api.acme.com/v1/.%2E/admin'],
    ['a backslash-separated ".." segment', 'https://api.acme.com/v1\\..\\admin'],
  ])('refuses a URL whose %s resolves above the resource', (_case, url) => {
    expect(callerTokenRefusal(token, url)).toMatch(/was not issued for https:\/\/api\.acme\.com\/admin /);
  });

  it.each([
    ['an encoded slash', 'https://api.acme.com/v1/..%2F..%2Fadmin'],
    ['an encoded backslash', 'https://api.acme.com/v1/..%5C..%5Cadmin'],
    ['double encoding', 'https://api.acme.com/v1/%252e%252e/%252E%252E/admin'],
    ['a path parameter', 'https://api.acme.com/v1/..;x/admin'],
    ['an encoded path parameter', 'https://api.acme.com/v1/..%3B/admin'],
  ])('refuses a ".." segment hidden by %s', (_case, url) => {
    expect(callerTokenRefusal(token, url)).toMatch(/has a "\.\." segment once percent-decoded/);
  });

  it.each([
    ['another host', 'https://evil.example.com/v1/me'],
    ['a host that extends the API host', 'https://api.acme.com.evil.example/v1/me'],
    ['another port', 'https://api.acme.com:8443/v1/me'],
    ['another scheme', 'http://api.acme.com/v1/me'],
    ['a sibling path', 'https://api.acme.com/v10/me'],
  ])('refuses %s', (_case, url) => {
    expect(callerTokenRefusal(token, url)).toMatch(/was not issued for/);
  });

  it('names the resolved URL, without its query, in the refusal', () => {
    expect(callerTokenRefusal(token, 'https://api.acme.com/v1/../admin?key=secret')).toBe(
      'the caller token was not issued for https://api.acme.com/admin (no resource or aud claim names it)',
    );
  });
});
