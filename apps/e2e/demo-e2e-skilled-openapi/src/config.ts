// The config both entrypoints run, with the plugin set up as in production; e2e/helpers/production-environment.ts makes its inputs.

import SkilledOpenApiPlugin, {
  SkilledOpenApiCredentialResolver,
  type SignatureKey,
  type SkilledOpenApiPluginOptionsInput,
} from '@frontmcp/plugin-skilled-openapi';
import { LogLevel } from '@frontmcp/sdk';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set: the e2e specs set it (e2e/helpers/production-environment.ts)`);
  }
  return value;
}

/** The environment variable that holds each `vaultRef` of the bundle's auth bindings. */
const CREDENTIAL_VARIABLES: Readonly<Record<string, string>> = { 'billing-token': 'BILLING_API_TOKEN' };

/** Reads a credential from the environment each time the plugin asks for one, as a vault adapter reads its vault. */
class EnvironmentCredentialResolver extends SkilledOpenApiCredentialResolver {
  async resolve(ref: string): Promise<string | undefined> {
    const variable = CREDENTIAL_VARIABLES[ref];
    return variable ? process.env[variable] : undefined;
  }
}

export function skilledOpenApiPlugin(callerCredentials: Pick<SkilledOpenApiPluginOptionsInput, 'authProviders'> = {}) {
  return SkilledOpenApiPlugin.init({
    ...callerCredentials,
    source: { type: 'static' as const, path: requiredEnv('SKILLED_BUNDLE_PATH'), watch: false },
    requireSignature: true,
    trustedKeys: [JSON.parse(requiredEnv('SKILLED_TRUSTED_KEY')) as SignatureKey],
    unprotectedOps: 'deny' as const,
    outbound: {
      // The one exception to production settings: the mock billing API listens on loopback.
      allowPrivateNetworks: true,
      defaultTimeoutMs: 5_000,
      defaultMaxResponseBytes: 256 * 1024,
      maxConcurrencyPerHost: 10,
    },
  });
}

export const serverConfig = {
  info: { name: 'Demo E2E Skilled-OpenAPI', version: '0.1.0' },
  // Typed as `unknown[]`: an empty array literal infers `never[]`.
  apps: [] as unknown[],
  plugins: [skilledOpenApiPlugin()],
  // Declared on the server, not in init({ providers }): the plugin uses it in place of its built-in resolver.
  providers: [{ provide: SkilledOpenApiCredentialResolver, useValue: new EnvironmentCredentialResolver() }],
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
