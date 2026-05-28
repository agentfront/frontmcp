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

  it('walks up from a nested candidate path to find @frontmcp/ui at the workspace root', () => {
    // In the monorepo, `@frontmcp/ui` is symlinked only at
    // `<repo>/node_modules/@frontmcp/ui` (yarn workspaces). Probing from a
    // deeply nested path must climb parent dirs to reach the workspace root,
    // mirroring Node's own `node_modules` resolution.
    // process.cwd() during tests is the package dir (e.g. `libs/uipack`), so
    // diving even deeper gives the walk something to climb.
    const deepCandidate = path.join(process.cwd(), 'src', 'component', '__tests__');
    expect(isFrontmcpUiResolvable(deepCandidate)).toBe(true);
  });

  it('returns false when no candidate path can resolve @frontmcp/ui', () => {
    // Walking up from this path won't find `node_modules/@frontmcp/ui` at
    // any ancestor of `/` (filesystem root has no such directory on a
    // typical host).
    const isolated = path.join('/', 'no-such-dir-for-frontmcp-ui-availability-test');
    expect(isFrontmcpUiResolvable(isolated)).toBe(false);
  });

  it('returns false when called with no candidates', () => {
    expect(isFrontmcpUiResolvable()).toBe(false);
  });
});
