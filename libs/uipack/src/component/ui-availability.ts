/**
 * @frontmcp/ui availability check for FileSource bundling.
 *
 * `bundleFileSource` injects an auto-generated mount that imports from
 * `@frontmcp/ui/react`. If `@frontmcp/ui` isn't installed in the consuming
 * project, esbuild fails with a cryptic `Could not resolve` error. This
 * preflight detects the missing package up-front so consumers see actionable
 * guidance instead (issue #443).
 *
 * Browser-safe: `require` / `require.resolve` are Node-only. In a browser
 * build the function returns `false` (no `@frontmcp/ui` to resolve against
 * the filesystem) rather than throwing — uipack is on track to be importable
 * from browser bundles, and the bundling code-path that gates on this check
 * shouldn't run in a browser anyway.
 *
 * Extracted to its own module so tests can mock it without touching the
 * global Node module resolver.
 */
export function isFrontmcpUiResolvable(...candidatePaths: string[]): boolean {
  if (typeof require === 'undefined' || typeof require.resolve !== 'function') {
    return false;
  }
  for (const candidate of candidatePaths) {
    try {
      require.resolve('@frontmcp/ui/package.json', { paths: [candidate] });
      return true;
    } catch {
      continue;
    }
  }
  return false;
}
