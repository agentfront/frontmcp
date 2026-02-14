// options/orchestrated.schema.ts
// Orchestrated mode - Local auth server that can proxy to remote or be fully local

import { z } from 'zod';
import {
  cimdConfigSchema,
  consentConfigSchema,
  federatedAuthConfigSchema,
  incrementalAuthConfigSchema,
  localSigningConfigSchema,
  publicAccessConfigSchema,
  remoteProviderConfigSchema,
  tokenRefreshConfigSchema,
  tokenStorageConfigSchema,
} from './shared.schemas';

// ============================================
// SHARED ORCHESTRATED FIELDS
// Common fields between local and remote modes
// ============================================

const orchestratedSharedFields = {
  local: localSigningConfigSchema.optional(),
  tokenStorage: tokenStorageConfigSchema.default({ type: 'memory' }),
  allowDefaultPublic: z.boolean().default(false),
  anonymousScopes: z.array(z.string()).default(['anonymous']),
  publicAccess: publicAccessConfigSchema.optional(),
  consent: consentConfigSchema.optional(),
  federatedAuth: federatedAuthConfigSchema.optional(),
  refresh: tokenRefreshConfigSchema.optional(),
  expectedAudience: z.union([z.string(), z.array(z.string())]).optional(),
  incrementalAuth: incrementalAuthConfigSchema.optional(),
  cimd: cimdConfigSchema.optional(),
};

// ============================================
// ORCHESTRATED LOCAL MODE
// ============================================

export const orchestratedLocalSchema = z.object({
  mode: z.literal('orchestrated'),
  type: z.literal('local'),
  ...orchestratedSharedFields,
});

// ============================================
// ORCHESTRATED REMOTE MODE
// ============================================

export const orchestratedRemoteSchema = z.object({
  mode: z.literal('orchestrated'),
  type: z.literal('remote'),
  remote: remoteProviderConfigSchema,
  ...orchestratedSharedFields,
});

// ============================================
// COMBINED ORCHESTRATED SCHEMA
// ============================================

export const orchestratedAuthOptionsSchema = z.discriminatedUnion('type', [
  orchestratedLocalSchema,
  orchestratedRemoteSchema,
]);

// ============================================
// TYPE EXPORTS
// ============================================

export type OrchestratedLocalOptions = z.infer<typeof orchestratedLocalSchema>;
export type OrchestratedLocalOptionsInput = z.input<typeof orchestratedLocalSchema>;

export type OrchestratedRemoteOptions = z.infer<typeof orchestratedRemoteSchema>;
export type OrchestratedRemoteOptionsInput = z.input<typeof orchestratedRemoteSchema>;

export type OrchestratedAuthOptions = z.infer<typeof orchestratedAuthOptionsSchema>;
export type OrchestratedAuthOptionsInput = z.input<typeof orchestratedAuthOptionsSchema>;

export type OrchestratedType = 'local' | 'remote';
