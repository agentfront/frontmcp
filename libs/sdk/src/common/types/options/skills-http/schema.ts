// common/types/options/skills-http/schema.ts
// Zod schema for skills HTTP configuration

import { z } from 'zod';
import type { SkillsConfigAuthMode } from './interfaces';

/**
 * Authentication mode schema for skills HTTP endpoints.
 */
export const skillsConfigAuthModeSchema = z.enum(['inherit', 'public', 'api-key', 'bearer']);

/**
 * Endpoint configuration schema (simplified - no auth, just enabled and path).
 */
export const skillsConfigEndpointConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  path: z.string().optional(),
});

/**
 * Union type for endpoint configuration (config object or boolean).
 */
const skillsConfigEndpointInputSchema = z.union([skillsConfigEndpointConfigSchema, z.boolean()]);

/**
 * JWT validation configuration schema.
 */
export const skillsConfigJwtOptionsSchema = z.object({
  issuer: z.string().min(1),
  audience: z.string().optional(),
  jwksUrl: z.string().url().optional(),
});

/**
 * Cache configuration schema.
 *
 * Supports 'redis' (uses ioredis under the hood) and 'vercel-kv' providers.
 */
export const skillsConfigCacheOptionsSchema = z.object({
  enabled: z.boolean().optional().default(false),
  redis: z
    .object({
      provider: z.enum(['redis', 'vercel-kv', '@vercel/kv']),
      host: z.string().optional(),
      port: z.number().int().positive().optional(),
      password: z.string().optional(),
      db: z.number().int().nonnegative().optional(),
    })
    .optional(),
  ttlMs: z.number().int().positive().optional().default(60000),
  keyPrefix: z.string().optional(),
});

/**
 * Skills HTTP options Zod schema.
 * Auth is configured at the top level and applies to all HTTP endpoints.
 */
export const skillsConfigOptionsSchema = z.object({
  enabled: z.boolean().optional().default(false),
  prefix: z.string().optional(),
  auth: skillsConfigAuthModeSchema.optional().default('inherit'),
  apiKeys: z.array(z.string().min(1)).optional(),
  jwt: skillsConfigJwtOptionsSchema.optional(),
  llmTxt: skillsConfigEndpointInputSchema.optional().default(true),
  llmFullTxt: skillsConfigEndpointInputSchema.optional().default(true),
  api: skillsConfigEndpointInputSchema.optional().default(true),
  mcpTools: z.boolean().optional().default(true),
  cache: skillsConfigCacheOptionsSchema.optional(),
});

/**
 * Skills HTTP options type (with defaults applied).
 */
export type SkillsConfigOptions = z.infer<typeof skillsConfigOptionsSchema>;

/**
 * Skills HTTP options input type (for user configuration).
 */
export type SkillsConfigOptionsInput = z.input<typeof skillsConfigOptionsSchema>;

/**
 * Skills HTTP endpoint config type (with defaults applied).
 */
export type SkillsConfigEndpointConfig = z.infer<typeof skillsConfigEndpointConfigSchema>;

/**
 * Skills HTTP endpoint config input type.
 */
export type SkillsConfigEndpointConfigInput = z.input<typeof skillsConfigEndpointConfigSchema>;

/**
 * Normalized endpoint configuration with auth from parent.
 * This is the result of normalizing an endpoint config with the parent's auth settings.
 */
export interface NormalizedEndpointConfig {
  enabled: boolean;
  path: string;
  auth: SkillsConfigAuthMode;
  apiKeys?: string[];
}

/**
 * Normalize endpoint configuration.
 * Converts boolean or config object to normalized config object.
 * Auth settings come from the parent skillsConfig, not per-endpoint.
 */
export function normalizeEndpointConfig(
  config: boolean | SkillsConfigEndpointConfig | undefined,
  defaultPath: string,
  parentAuth: SkillsConfigAuthMode,
  parentApiKeys?: string[],
): NormalizedEndpointConfig {
  if (config === undefined || config === true) {
    return {
      enabled: true,
      path: defaultPath,
      auth: parentAuth,
      apiKeys: parentApiKeys,
    };
  }
  if (config === false) {
    return {
      enabled: false,
      path: defaultPath,
      auth: parentAuth,
      apiKeys: parentApiKeys,
    };
  }
  return {
    enabled: config.enabled !== false,
    path: config.path ?? defaultPath,
    auth: parentAuth,
    apiKeys: parentApiKeys,
  };
}

/**
 * Normalize skills HTTP options.
 * Applies defaults and normalizes all endpoint configurations.
 * Auth is applied from the top level to all endpoints.
 */
export function normalizeSkillsConfigOptions(options: SkillsConfigOptionsInput | undefined): SkillsConfigOptions & {
  normalizedLlmTxt: NormalizedEndpointConfig;
  normalizedLlmFullTxt: NormalizedEndpointConfig;
  normalizedApi: NormalizedEndpointConfig;
} {
  const parsed = skillsConfigOptionsSchema.parse(options ?? {});
  const auth = parsed.auth ?? 'inherit';
  const apiKeys = parsed.apiKeys;

  // Normalize prefix: ensure leading slash, remove trailing slash
  let prefix = parsed.prefix ?? '';
  if (prefix) {
    if (!prefix.startsWith('/')) {
      prefix = '/' + prefix;
    }
    if (prefix.endsWith('/')) {
      prefix = prefix.slice(0, -1);
    }
  }

  return {
    ...parsed,
    normalizedLlmTxt: normalizeEndpointConfig(parsed.llmTxt, `${prefix}/llm.txt`, auth, apiKeys),
    normalizedLlmFullTxt: normalizeEndpointConfig(parsed.llmFullTxt, `${prefix}/llm_full.txt`, auth, apiKeys),
    normalizedApi: normalizeEndpointConfig(parsed.api, `${prefix}/skills`, auth, apiKeys),
  };
}
