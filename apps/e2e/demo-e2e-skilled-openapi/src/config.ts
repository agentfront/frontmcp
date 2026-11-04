// The config both entrypoints run, with the plugin set up as in production; e2e/helpers/production-environment.ts makes its inputs.

import SkilledOpenApiPlugin, { type SignatureKey } from '@frontmcp/plugin-skilled-openapi';
import { LogLevel } from '@frontmcp/sdk';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set: the e2e specs set it (e2e/helpers/production-environment.ts)`);
  }
  return value;
}

export const serverConfig = {
  info: { name: 'Demo E2E Skilled-OpenAPI', version: '0.1.0' },
  // Typed as `unknown[]`: an empty array literal infers `never[]`.
  apps: [] as unknown[],
  plugins: [
    SkilledOpenApiPlugin.init({
      source: { type: 'static' as const, path: requiredEnv('SKILLED_BUNDLE_PATH'), watch: false },
      requireSignature: true,
      trustedKeys: [JSON.parse(requiredEnv('SKILLED_TRUSTED_KEY')) as SignatureKey],
      unprotectedOps: 'deny' as const,
      credentials: { 'billing-token': requiredEnv('BILLING_API_TOKEN') },
      outbound: {
        // The one exception to production settings: the mock billing API listens on loopback.
        allowPrivateNetworks: true,
        defaultTimeoutMs: 5_000,
        defaultMaxResponseBytes: 256 * 1024,
        maxConcurrencyPerHost: 10,
      },
    }),
  ],
  authorities: { claimsMapping: { roles: 'realm_access.roles' } },
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
