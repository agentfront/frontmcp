/**
 * `matchMountedPath` is how a runtime with no middleware server (the fetch
 * handler, Workers) decides which flow a request belongs to. It must mount a
 * flow's `middleware.path` the way Express's `router.use()` does, `:param`
 * segments included, or a flow such as `/oauth/provider/:providerId/callback`
 * is unreachable there.
 */
import { matchMountedPath } from '../flow.http-path';

describe('matchMountedPath', () => {
  describe('literal paths (unchanged from the prefix match)', () => {
    it.each([
      ['/oauth/token', '/oauth/token'],
      ['/oauth/token', '/oauth/token/extra'],
      ['/', '/anything/at/all'],
      ['/', '/'],
    ])('mounts %s on %s', (pattern, path) => {
      expect(matchMountedPath(pattern, path)).toEqual({});
    });

    it.each([
      ['/oauth/token', '/oauth/tokens'],
      ['/oauth/token', '/oauth'],
      ['/oauth/token', '/OAUTH/token'],
      ['/oauth/token/', '/oauth/token'],
    ])('does not mount %s on %s', (pattern, path) => {
      expect(matchMountedPath(pattern, path)).toBeUndefined();
    });
  });

  describe('paths with parameters', () => {
    const pattern = '/oauth/provider/:providerId/callback';

    it('captures a parameter', () => {
      expect(matchMountedPath(pattern, '/oauth/provider/github/callback')).toEqual({ providerId: 'github' });
    });

    it('mounts as a prefix at a segment boundary, like router.use()', () => {
      expect(matchMountedPath(pattern, '/oauth/provider/github/callback/')).toEqual({ providerId: 'github' });
      expect(matchMountedPath(pattern, '/oauth/provider/github/callback/more')).toEqual({ providerId: 'github' });
      expect(matchMountedPath(pattern, '/oauth/provider/github/callbacks')).toBeUndefined();
    });

    it('percent-decodes the captured segment', () => {
      expect(matchMountedPath(pattern, '/oauth/provider/git%68ub/callback')).toEqual({ providerId: 'github' });
      expect(matchMountedPath(pattern, '/oauth/provider/a%2Fb/callback')).toEqual({ providerId: 'a/b' });
    });

    it('does not match malformed percent-encoding', () => {
      expect(matchMountedPath(pattern, '/oauth/provider/%E0%A4%A/callback')).toBeUndefined();
    });

    it('needs a non-empty segment for the parameter', () => {
      expect(matchMountedPath(pattern, '/oauth/provider//callback')).toBeUndefined();
    });

    it('compares the literal segments exactly', () => {
      expect(matchMountedPath(pattern, '/oauth/providers/github/callback')).toBeUndefined();
      expect(matchMountedPath(pattern, '/oauth/provider/github')).toBeUndefined();
      expect(matchMountedPath(pattern, '/other/provider/github/callback')).toBeUndefined();
    });

    it('allows a trailing slash on the pattern', () => {
      expect(matchMountedPath(`${pattern}/`, '/oauth/provider/github/callback')).toEqual({ providerId: 'github' });
    });

    it('captures several parameters', () => {
      expect(matchMountedPath('/a/:first/b/:second', '/a/1/b/2')).toEqual({ first: '1', second: '2' });
    });
  });
});
