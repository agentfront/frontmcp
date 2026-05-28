/**
 * `@frontmcp/ui` availability check for FileSource bundling.
 *
 * `bundleFileSource` injects an auto-generated mount that imports from
 * `@frontmcp/ui/react`. If `@frontmcp/ui` isn't installed in the consuming
 * project, esbuild fails with a cryptic `Could not resolve` error. This
 * preflight detects the missing package up-front so consumers see actionable
 * guidance instead (issue #443).
 *
 * Implementation note: we deliberately probe the filesystem directly with
 * `fs.existsSync(<dir>/node_modules/@frontmcp/ui/package.json)` rather than
 * `require.resolve('@frontmcp/ui/...')`. The latter would surface as a
 * module-specifier reference to the `@frontmcp/ui` workspace package and
 * trip the Nx `@nx/enforce-module-boundaries` rule (uipack must not depend
 * on ui), even though it's a runtime resolution check rather than a real
 * import. Using a filesystem probe keeps the dependency graph one-way.
 *
 * Browser-safe: `require('fs')` is Node-only. In a browser build we return
 * `false` rather than throwing — uipack is on track to be importable from
 * browser bundles, and the bundling code-path that gates on this check
 * shouldn't run in a browser anyway.
 *
 * Extracted to its own module so tests can mock it without touching the
 * global Node module resolver.
 */
export function isFrontmcpUiResolvable(...candidatePaths: string[]): boolean {
  try {
    // Lazy-require so this file doesn't pull `fs` into browser builds.
    const nodeFs = require('fs') as typeof import('fs');
    const nodePath = require('path') as typeof import('path');
    // We probe for the package's `package.json` walking up each candidate's
    // parent dirs, mirroring Node's `node_modules` resolution. That handles
    // both consumer-project layouts (`<root>/node_modules/@frontmcp/ui`) and
    // yarn-workspace layouts (the symlink only exists at the workspace root,
    // not under each sub-package).
    const ORG = '@frontmcp';
    const PKG = 'ui';
    for (const candidate of candidatePaths) {
      let dir = candidate;
      while (true) {
        const pkgJson = nodePath.join(dir, 'node_modules', ORG, PKG, 'package.json');
        if (nodeFs.existsSync(pkgJson)) return true;
        const parent = nodePath.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }
    return false;
  } catch {
    // No `fs` available (browser) — degrade to `false`.
    return false;
  }
}
