/**
 * @file esm-auth.types.ts
 * @description Authentication configuration for private npm registries and esm.sh CDN.
 */

import { z } from '@frontmcp/lazy-zod';

/**
 * Authentication configuration for accessing private npm registries.
 * Used both for version resolution (npm registry API) and ESM bundle fetching.
 */
export interface EsmRegistryAuth {
  /**
   * Custom registry URL (e.g., 'https://npm.pkg.github.com').
   * If not provided, defaults to 'https://registry.npmjs.org'.
   */
  registryUrl?: string;

  /**
   * Bearer token for authentication.
   * Mutually exclusive with `tokenEnvVar`.
   */
  token?: string;

  /**
   * Environment variable name containing the bearer token.
   * Resolved at runtime for security (avoids storing tokens in config).
   * Mutually exclusive with `token`.
   */
  tokenEnvVar?: string;
}

/**
 * Zod schema for EsmRegistryAuth validation.
 */
export const esmRegistryAuthSchema = z
  .object({
    registryUrl: z.string().url().optional(),
    token: z.string().min(1).optional(),
    tokenEnvVar: z.string().min(1).optional(),
  })
  .refine((data) => !(data.token && data.tokenEnvVar), {
    message: 'Cannot specify both "token" and "tokenEnvVar" — use one or the other',
  });

/**
 * Default npm registry URL.
 */
export const DEFAULT_NPM_REGISTRY = 'https://registry.npmjs.org';

/**
 * Resolve the bearer token from an EsmRegistryAuth configuration.
 * Handles both direct tokens and environment variable references.
 *
 * @param auth - Registry auth configuration (optional)
 * @returns The resolved token, or undefined if no auth configured
 * @throws Error if tokenEnvVar is specified but the environment variable is not set
 */
export function resolveRegistryToken(auth?: EsmRegistryAuth): string | undefined {
  if (!auth) return undefined;

  if (auth.token) {
    return auth.token;
  }

  if (auth.tokenEnvVar) {
    const token = process.env[auth.tokenEnvVar];
    if (!token) {
      throw new Error(
        `Environment variable "${auth.tokenEnvVar}" is not set. ` + 'Required for private npm registry authentication.',
      );
    }
    return token;
  }

  return undefined;
}

/**
 * Get the registry URL from auth configuration, falling back to default.
 */
export function getRegistryUrl(auth?: EsmRegistryAuth): string {
  return auth?.registryUrl ?? DEFAULT_NPM_REGISTRY;
}
