/**
 * Tests for `isFrontmcpUiResolvable` — the preflight check used by
 * `bundleFileSource` to detect a missing `@frontmcp/ui` package and surface
 * a consumer-friendly error (issue #443).
 */
import * as path from 'node:path';

import { isFrontmcpUiResolvable } from '../ui-availability';

describe('isFrontmcpUiResolvable', () => {
  it('returns true when @frontmcp/ui resolves from the repo root', () => {
    expect(isFrontmcpUiResolvable(process.cwd())).toBe(true);
  });

  it('returns true when at least one candidate resolves', () => {
    expect(isFrontmcpUiResolvable('/no-such-dir', process.cwd())).toBe(true);
  });

  it('returns false when no candidate path can resolve @frontmcp/ui', () => {
    // `paths` is passed verbatim to Node's resolver (no walk-up), so a path that
    // has no `node_modules/@frontmcp/ui/package.json` underneath it cannot resolve.
    const isolated = path.join('/', 'no-such-dir-for-frontmcp-ui-availability-test');
    expect(isFrontmcpUiResolvable(isolated)).toBe(false);
  });

  it('returns false when called with no candidates', () => {
    expect(isFrontmcpUiResolvable()).toBe(false);
  });
});
