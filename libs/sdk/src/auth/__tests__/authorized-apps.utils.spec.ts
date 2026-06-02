/**
 * authorized-apps.utils — reading the `authorized_apps` claim from a verified
 * authInfo (progressive/incremental authorization source).
 */
import { getAuthorizedAppIds } from '../authorized-apps.utils';

function jwtWith(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

describe('getAuthorizedAppIds', () => {
  it('returns undefined for no authInfo (allow-all / default preserved)', () => {
    expect(getAuthorizedAppIds(undefined)).toBeUndefined();
  });

  it('returns undefined when no authorized_apps claim is present anywhere', () => {
    expect(getAuthorizedAppIds({ extra: { user: { sub: 'u1' } } })).toBeUndefined();
  });

  it('reads from extra.user.authorized_apps (HTTP request flow projection)', () => {
    const set = getAuthorizedAppIds({ extra: { user: { authorized_apps: ['notes', 'tasks'] } } });
    expect(set).toEqual(new Set(['notes', 'tasks']));
  });

  it('reads from extra.authorized_apps', () => {
    const set = getAuthorizedAppIds({ extra: { authorized_apps: ['notes'] } });
    expect(set).toEqual(new Set(['notes']));
  });

  it('reads from top-level user.authorized_apps', () => {
    const set = getAuthorizedAppIds({ user: { authorized_apps: ['tasks'] } });
    expect(set).toEqual(new Set(['tasks']));
  });

  it('falls back to decoding the bearer token claim', () => {
    const token = jwtWith({ authorized_apps: ['notes', 'tasks'] });
    const set = getAuthorizedAppIds({ token, extra: {} });
    expect(set).toEqual(new Set(['notes', 'tasks']));
  });

  it('returns an EMPTY set when the claim is [] (grant revoked — still enforced)', () => {
    const set = getAuthorizedAppIds({ extra: { user: { authorized_apps: [] } } });
    expect(set).toEqual(new Set());
    // An empty set is NOT undefined — gating is active and denies all apps.
    expect(set).not.toBeUndefined();
  });

  it('ignores non-string entries in the claim', () => {
    const set = getAuthorizedAppIds({ extra: { user: { authorized_apps: ['notes', 42, null, 'tasks'] } } });
    expect(set).toEqual(new Set(['notes', 'tasks']));
  });

  it('returns undefined when the claim is not an array', () => {
    expect(getAuthorizedAppIds({ extra: { user: { authorized_apps: 'notes' } } })).toBeUndefined();
  });
});
