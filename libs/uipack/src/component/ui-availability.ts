/**
 * @frontmcp/ui availability check for FileSource bundling.
 *
 * `bundleFileSource` injects an auto-generated mount that imports from
 * `@frontmcp/ui/react`. If `@frontmcp/ui` isn't installed in the consuming
 * project, esbuild fails with a cryptic `Could not resolve` error. This
 * preflight detects the missing package up-front so consumers see actionable
 * guidance instead (issue #443).
 *
 * Extracted to its own module so tests can mock it without touching the
 * global Node module resolver.
 */
export function isFrontmcpUiResolvable(...candidatePaths: string[]): boolean {
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
