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
