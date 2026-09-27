import { signinCookiePath } from '../signin-binding.utils';

describe('signinCookiePath', () => {
  it('scopes the cookie to /oauth when the OAuth URLs have no prefix', () => {
    expect(signinCookiePath('http://localhost:3001', '')).toBe('/oauth');
    expect(signinCookiePath('https://mcp.example.com/', '/')).toBe('/oauth');
  });

  it('uses / when the issuer or the scope carries a path, which the provider callback URL includes', () => {
    expect(signinCookiePath('http://localhost:3001/mcp', '/mcp')).toBe('/');
    expect(signinCookiePath('https://mcp.example.com', '/billing')).toBe('/');
    expect(signinCookiePath('https://mcp.example.com/auth', '')).toBe('/');
  });

  it('uses / for an issuer it cannot parse', () => {
    expect(signinCookiePath('', '')).toBe('/');
  });
});
