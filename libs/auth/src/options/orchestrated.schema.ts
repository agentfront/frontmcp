// options/orchestrated.schema.ts
// Local and Remote auth modes (formerly orchestrated local/remote)

import { z } from 'zod';
import {
  cimdConfigSchema,
  consentConfigSchema,
  federatedAuthConfigSchema,
  flatRemoteProviderFields,
  incrementalAuthConfigSchema,
  localSigningConfigSchema,
  publicAccessConfigSchema,
  tokenRefreshConfigSchema,
  tokenStorageConfigSchema,
} from './shared.schemas';

// ============================================
// SHARED LOCAL/REMOTE FIELDS
// Common fields between local and remote modes
// ============================================

const sharedAuthFields = {
  local: localSigningConfigSchema.optional(),
  tokenStorage: tokenStorageConfigSchema.default('memory'),
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
// LOCAL AUTH MODE (formerly orchestrated local)
// ============================================

export const localAuthSchema = z.object({
  mode: z.literal('local'),
  ...sharedAuthFields,
});

// ============================================
// REMOTE AUTH MODE (formerly orchestrated remote)
// ============================================

export const remoteAuthSchema = z.object({
  mode: z.literal('remote'),
  ...flatRemoteProviderFields,
  ...sharedAuthFields,
});

// ============================================
// TYPE EXPORTS
// ============================================

export type LocalAuthOptions = z.infer<typeof localAuthSchema>;
export type LocalAuthOptionsInput = z.input<typeof localAuthSchema>;

export type RemoteAuthOptions = z.infer<typeof remoteAuthSchema>;
export type RemoteAuthOptionsInput = z.input<typeof remoteAuthSchema>;

// Unified type for local + remote
export type LocalOrRemoteAuthOptions = LocalAuthOptions | RemoteAuthOptions;
export type LocalOrRemoteAuthOptionsInput = LocalAuthOptionsInput | RemoteAuthOptionsInput;

// ============================================
// BACKWARDS COMPAT ALIASES (deprecated, remove in next major)
// These map old names to new names for gradual migration
// ============================================

/** @deprecated Use localAuthSchema */
export const orchestratedLocalSchema = localAuthSchema;
/** @deprecated Use remoteAuthSchema */
export const orchestratedRemoteSchema = remoteAuthSchema;

/** @deprecated Use LocalAuthOptions */
export type OrchestratedLocalOptions = LocalAuthOptions;
/** @deprecated Use LocalAuthOptionsInput */
export type OrchestratedLocalOptionsInput = LocalAuthOptionsInput;

/** @deprecated Use RemoteAuthOptions */
export type OrchestratedRemoteOptions = RemoteAuthOptions;
/** @deprecated Use RemoteAuthOptionsInput */
export type OrchestratedRemoteOptionsInput = RemoteAuthOptionsInput;

/** @deprecated Use LocalOrRemoteAuthOptions */
export type OrchestratedAuthOptions = LocalOrRemoteAuthOptions;
/** @deprecated Use LocalOrRemoteAuthOptionsInput */
export type OrchestratedAuthOptionsInput = LocalOrRemoteAuthOptionsInput;
