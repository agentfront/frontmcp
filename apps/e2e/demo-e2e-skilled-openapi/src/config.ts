// file: apps/e2e/demo-e2e-skilled-openapi/src/config.ts
//
// Shared FrontMCP server configuration for the skilled-openapi e2e app.
// Extracted from main.ts so the HTTP entrypoint, stdio entrypoint, AND any
// future in-process `direct.create(...)` call all consume the same
// canonical config — preventing drift between transports.
//
// Pattern (mirrors `demo-e2e-stdio-transport/src/config.ts`): the base
// `serverConfig` is a plain const so TS inference produces a narrow shape
// the `@FrontMcp(...)` decorator and `FrontMcpInstance.runStdio(...)` both
// accept. Transport-specific fields (`http: { port }`) are spread in at
// the call site rather than computed via a function-returning-object that
// widens the inferred type.

import * as path from 'node:path';

import SkilledOpenApiPlugin from '@frontmcp/plugin-skilled-openapi';
import { LogLevel } from '@frontmcp/sdk';

/** Resolved path to the static-source bundle the plugin loads on boot. */
export const BUNDLE_PATH = path.resolve(__dirname, 'fixtures/billing-bundle.json');

/**
 * Transport-agnostic FrontMCP config. Add the HTTP block at the call site
 * (HTTP entrypoint) or omit it entirely (stdio entrypoint).
 *
 * The trailing `as const satisfies Record<string, unknown>` keeps inference
 * narrow for the field values (so `mode: 'public'` is the literal, not
 * `string`) while declining to constrain the OUTER shape against the
 * `FrontMcpMetadata` union directly — that union's discriminator
 * (`splitByApp`) would force us to pick a branch and add a literal we
 * don't otherwise need. Both `@FrontMcp(...)` and
 * `FrontMcpInstance.runStdio(...)` accept an object literal of this exact
 * shape; the Zod schema underneath both is what enforces correctness at
 * runtime. (E2E tests are NOT a sensible place to drag in the union
 * discriminator.)
 */
export const serverConfig = {
  info: { name: 'Demo E2E Skilled-OpenAPI', version: '0.1.0' },
  // `apps` MUST be present (Zod schema requires the array even if empty).
  // Typed as `unknown[]` to bypass the literal-empty-array `never[]`
  // inference; the call sites cast the whole config to the decorator/runStdio
  // input type so this widening doesn't propagate further.
  apps: [] as unknown[],
  plugins: [
    SkilledOpenApiPlugin.init({
      source: { type: 'static' as const, path: BUNDLE_PATH, watch: false },
      dev: true,
      requireSignature: false,
      trustedKeys: [],
      credentials: { 'billing-token': 'demo-bearer-xyz' },
      outbound: {
        allowHttp: true,
        allowPrivateNetworks: true,
        defaultTimeoutMs: 5_000,
        defaultMaxResponseBytes: 256 * 1024,
        maxConcurrencyPerHost: 10,
      },
      sourceConflictPolicy: 'static-wins' as const,
    }),
  ],
  logging: { level: LogLevel.Warn },
  auth: {
    mode: 'public' as const,
    sessionTtl: 3600,
    anonymousScopes: ['anonymous'],
  },
  transport: {
    protocol: { json: true, legacy: true, strictSession: false },
  },
};
