/**
 * resolvePrincipal — the identity every permission check evaluates against
 * (GHSA-58v2-gpcc-jmqv).
 *
 * Two things matter here. The claim SOURCES have to cover every transport (the
 * Node path puts the user at the top level, the web/worker path under
 * `extra.user`), and source selection has to go by PRESENCE rather than by
 * "first non-empty" — an explicitly empty array is a statement about the
 * caller, not a gap to fill from a weaker source.
 */
import { resolvePrincipal } from '../principal.utils';

describe('resolvePrincipal — sources', () => {
  it('reads roles from user.roles', () => {
    expect(resolvePrincipal({ user: { roles: ['admin'] } }).roles).toEqual(['admin']);
  });

  it('reads roles from verified token claims', () => {
    expect(resolvePrincipal({ claims: { roles: ['admin'] } }).roles).toEqual(['admin']);
  });

  it('falls back to the authorization scopes for roles', () => {
    const authInfo = { extra: { authorization: { scopes: ['admin'] } } };
    expect(resolvePrincipal(authInfo).roles).toEqual(['admin']);
  });

  it('reads the verified scope set from AuthInfo', () => {
    expect(resolvePrincipal({ scopes: ['reports:run'] }).scopes).toEqual(['reports:run']);
  });

  it('splits a space-delimited scope claim', () => {
    expect(resolvePrincipal({ claims: { scope: 'openid reports:run' } }).scopes).toEqual(['openid', 'reports:run']);
  });

  it('resolves the subject', () => {
    expect(resolvePrincipal({ user: { sub: 'user-1' } }).sub).toBe('user-1');
    expect(resolvePrincipal({}).sub).toBe('');
  });

  it('returns empty sets for an anonymous caller', () => {
    const principal = resolvePrincipal(undefined);
    expect(principal).toEqual({ sub: '', roles: [], permissions: [], scopes: [], claims: {} });
  });
});

describe('resolvePrincipal — presence beats emptiness', () => {
  it('still reads the token scope when AuthInfo.scopes is empty', () => {
    // `AuthInfo.scopes` is required by the protocol type, so it is always
    // present and an empty array there states nothing — a session-reconstructed
    // authorization legitimately has none while the verified token still
    // carries its scope. Every source here comes from the same verified token,
    // so falling through does not weaken the check.
    const authInfo = { scopes: [], claims: { scope: 'reports:run' } };

    expect(resolvePrincipal(authInfo).scopes).toEqual(['reports:run']);
  });

  it('prefers AuthInfo.scopes when it is populated', () => {
    const authInfo = { scopes: ['direct'], claims: { scope: 'from-claim' } };

    expect(resolvePrincipal(authInfo).scopes).toEqual(['direct']);
  });

  it('treats an explicitly empty OPTIONAL scope source as authoritative', () => {
    // Unlike AuthInfo.scopes, `extra.authorization.scopes` is optional — an
    // empty array there IS a statement, so the claim must not override it.
    const authInfo = { extra: { authorization: { scopes: [] } }, claims: { scope: 'reports:run' } };

    expect(resolvePrincipal(authInfo).scopes).toEqual([]);
  });

  it('treats an explicitly empty role set as authoritative', () => {
    const authInfo = { user: { roles: [] }, claims: { roles: ['admin'] } };

    expect(resolvePrincipal(authInfo).roles).toEqual([]);
  });

  it('still falls through when the field is absent rather than empty', () => {
    expect(resolvePrincipal({ claims: { scope: 'reports:run' } }).scopes).toEqual(['reports:run']);
    expect(resolvePrincipal({ user: {}, claims: { roles: ['admin'] } }).roles).toEqual(['admin']);
  });

  it('matches AuthoritiesContextBuilder, which preserves an empty user.roles', () => {
    // Both paths must agree on what an empty array means, or a server behaves
    // differently depending on whether it configured `authorities`.
    const authInfo = { user: { roles: [] }, extra: { authorization: { scopes: ['admin'] } } };

    expect(resolvePrincipal(authInfo).roles).toEqual([]);
  });
});

describe('resolvePrincipal — authorities context builder', () => {
  it('defers to the configured claims mapping when one exists', () => {
    const contextBuilder = {
      build: () => ({ user: { sub: 'u', roles: ['mapped'], permissions: ['p'], claims: { a: 1 } } }),
    } as never;

    const principal = resolvePrincipal({ user: { roles: ['ignored'] } }, contextBuilder);

    expect(principal.roles).toEqual(['mapped']);
    expect(principal.permissions).toEqual(['p']);
  });

  it('still resolves scopes itself, which the builder does not model', () => {
    const contextBuilder = {
      build: () => ({ user: { sub: 'u', roles: [], permissions: [], claims: {} } }),
    } as never;

    expect(resolvePrincipal({ scopes: ['reports:run'] }, contextBuilder).scopes).toEqual(['reports:run']);
  });
});
