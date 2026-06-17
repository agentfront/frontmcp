/**
 * Managed-edge fixture worker — the `@frontmcp/edge` auto-update path.
 *
 * A ~15-line Worker: no decorators, no `frontmcp build`. `createEdgeMcp` wires
 * the skilled-openapi plugin against a SaaS endpoint, persists the last-good
 * bundle to a **KV namespace** (resolved from `env` via `kvBundleCacheFromEnv`),
 * and exports `{ fetch, scheduled }` so a Cron Trigger drives refresh. The e2e
 * bundles this with esbuild and boots it in workerd (via miniflare).
 *
 * `__E2E_BUNDLE_ENDPOINT__` is substituted at bundle time (esbuild `define`)
 * with the fake bundle server's actual URL — Worker bindings/vars don't exist
 * at module-eval, so the test injects the endpoint into the bundle directly.
 */
import 'reflect-metadata';

import { createEdgeMcp, kvBundleCacheFromEnv } from '@frontmcp/edge';

declare const __E2E_BUNDLE_ENDPOINT__: string;

export default createEdgeMcp({
  info: { name: 'cf-managed-fixture', version: '1.0.0' },
  apps: [],
  // No Redis on this Worker; background tasks need distributed storage.
  tasks: { enabled: false },
  managed: {
    endpoint: __E2E_BUNDLE_ENDPOINT__,
    authToken: 'test-token',
    expectedAudience: 'e2e:prod',
    jwksUrl: `${__E2E_BUNDLE_ENDPOINT__}/jwks`,
    expectedIssuer: __E2E_BUNDLE_ENDPOINT__,
    // E2E: skip signature verification so the fake server can serve an unsigned
    // bundle. NEVER do this in production.
    dev: true,
    requireSignature: false,
    // KV namespace binding, resolved from the per-request `env` (CF bindings
    // live on `env`, not module scope). This is the worker-safe last-good cache.
    cache: kvBundleCacheFromEnv('BUNDLE_CACHE'),
  },
});
