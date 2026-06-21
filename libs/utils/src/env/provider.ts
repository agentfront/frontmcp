/**
 * Deploy-provider detection (issue #417).
 *
 * `isServerless()` collapses every serverless env to a single boolean;
 * this returns the discriminated identity so `@Tool({ availableWhen: {
 * provider: ['vercel'] } })` can express provider-specific rules.
 *
 * Order matters — first match wins. A user can override detection by
 * setting `FRONTMCP_PROVIDER=<name>` explicitly (used by tests and by
 * Docker images that don't expose a discriminating env var).
 */

export type DeployProvider =
  | 'bare'
  | 'docker'
  | 'vercel'
  | 'lambda'
  | 'cloudflare'
  | 'netlify'
  | 'azure'
  | 'gcp'
  | 'fly'
  | 'render'
  | 'railway';

let cached: DeployProvider | undefined;

/**
 * Detect the current deploy provider. Cached per process.
 *
 * Detection rules (first match wins):
 *
 *   1. `FRONTMCP_PROVIDER` env var (override; trust whatever the operator set).
 *   2. `VERCEL` env var → `'vercel'`.
 *   3. `AWS_LAMBDA_FUNCTION_NAME` → `'lambda'`.
 *   4. `CF_PAGES` → `'cloudflare'`.
 *   5. `NETLIFY` → `'netlify'`.
 *   6. `AZURE_FUNCTIONS_ENVIRONMENT` → `'azure'`.
 *   7. `K_SERVICE` (Cloud Run / Knative) → `'gcp'`.
 *   8. `FLY_APP_NAME` → `'fly'`.
 *   9. `RENDER` → `'render'`.
 *  10. `RAILWAY_ENVIRONMENT` → `'railway'`.
 *  11. `/.dockerenv` exists → `'docker'`.
 *  12. Fallback: `'bare'`.
 */
export function detectProvider(): DeployProvider {
  if (cached) return cached;
  cached = detectProviderUncached();
  return cached;
}

function detectProviderUncached(): DeployProvider {
  const explicit = process.env['FRONTMCP_PROVIDER'];
  if (explicit && isKnownProvider(explicit)) return explicit;

  if (process.env['VERCEL']) return 'vercel';
  if (process.env['AWS_LAMBDA_FUNCTION_NAME']) return 'lambda';
  if (process.env['CF_PAGES']) return 'cloudflare';
  if (process.env['NETLIFY']) return 'netlify';
  if (process.env['AZURE_FUNCTIONS_ENVIRONMENT']) return 'azure';
  if (process.env['K_SERVICE']) return 'gcp';
  if (process.env['FLY_APP_NAME']) return 'fly';
  if (process.env['RENDER']) return 'render';
  if (process.env['RAILWAY_ENVIRONMENT']) return 'railway';

  try {
    // Docker detection is a Node-only last resort (serverless providers are
    // matched above). Lazy-`require('node:fs')` rather than a static import so
    // this module doesn't drag `node:fs` into worker/browser bundles — workerd
    // has no `node:fs` module, and a static import would fail the whole bundle
    // at load. On those runtimes the require throws and we fall through to 'bare'.
    const nodeFs = require('node:fs') as typeof import('node:fs');
    if (nodeFs.existsSync('/.dockerenv')) return 'docker';
  } catch {
    // ignore — non-Node runtime (no node:fs), or the Linux-only file is absent
  }
  return 'bare';
}

function isKnownProvider(value: string): value is DeployProvider {
  return (
    value === 'bare' ||
    value === 'docker' ||
    value === 'vercel' ||
    value === 'lambda' ||
    value === 'cloudflare' ||
    value === 'netlify' ||
    value === 'azure' ||
    value === 'gcp' ||
    value === 'fly' ||
    value === 'render' ||
    value === 'railway'
  );
}

/** Test helper — reset the cache between specs. */
export function resetProviderCacheForTesting(): void {
  cached = undefined;
}
