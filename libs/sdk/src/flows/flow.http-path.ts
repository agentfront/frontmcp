/**
 * Match a request path against a flow's `middleware.path` the way Express's
 * `router.use()` mounts it, for runtimes with no middleware server (the fetch
 * handler, Workers).
 *
 * - A pattern without parameters is a literal prefix that ends at a segment
 *   boundary (`/oauth/token` mounts `/oauth/token` and `/oauth/token/x`).
 * - A `:name` segment matches one non-empty segment and captures it,
 *   percent-decoded (`/oauth/provider/:providerId/callback`). A segment that
 *   is not valid percent-encoding does not match.
 *
 * Literal segments compare exactly (case-sensitive), as the literal prefix
 * match always did.
 *
 * @param pattern - the flow's `middleware.path`
 * @param path - the request's path (no query string)
 * @returns the captured parameters (empty for a pattern without any), or
 *   `undefined` when the path does not match
 */
export function matchMountedPath(pattern: string, path: string): Record<string, string> | undefined {
  if (!pattern.includes('/:')) {
    const prefix = pattern.endsWith('/') ? pattern : `${pattern}/`;
    return path === pattern || path.startsWith(prefix) ? {} : undefined;
  }

  const mount = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;
  const expected = mount.split('/');
  const actual = path.split('/');
  if (actual.length < expected.length) return undefined;
  return captureSegments(expected, actual);
}

/**
 * Match a request path against a route's path the way Express's `router.get(path)` does for literal
 * and `:name` segments: the whole path, a trailing slash ignored. Other Express path syntax (`*`,
 * optional segments, regular expressions) does not match.
 *
 * @returns the captured parameters, or `undefined` when the path does not match
 */
export function matchRoutePath(pattern: string, path: string): Record<string, string> | undefined {
  const expected = withoutTrailingSlash(pattern).split('/');
  const actual = withoutTrailingSlash(path).split('/');
  if (actual.length !== expected.length) return undefined;
  return captureSegments(expected, actual);
}

function withoutTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/** The `:name` segments of `expected` captured from `actual`, or `undefined` when a literal segment differs. */
function captureSegments(expected: string[], actual: string[]): Record<string, string> | undefined {
  const params: Record<string, string> = {};
  for (let i = 0; i < expected.length; i++) {
    const segment = expected[i];
    const value = actual[i];
    if (segment.length > 1 && segment.startsWith(':')) {
      if (value.length === 0) return undefined;
      try {
        params[segment.slice(1)] = decodeURIComponent(value);
      } catch {
        return undefined;
      }
    } else if (segment !== value) {
      return undefined;
    }
  }
  return params;
}
