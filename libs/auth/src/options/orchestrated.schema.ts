// options/orchestrated.schema.ts
// Local and Remote auth modes (formerly orchestrated local/remote)

import { z } from '@frontmcp/lazy-zod';

import type { RawZodShape } from '../common/zod-utils';
import type {
  AuthenticateFn,
  LocalAuthOptionsInterface,
  LoginRenderContext,
  RemoteAuthOptionsInterface,
} from './interfaces';
import {
  cimdConfigSchema,
  consentConfigSchema,
  federatedAuthConfigSchema,
  flatRemoteProviderFields,
  incrementalAuthConfigSchema,
  localDcrConfigSchema,
  localSigningConfigSchema,
  publicAccessConfigSchema,
  secureStoreConfigSchema,
  tokenRefreshConfigSchema,
  tokenStorageConfigSchema,
  upstreamProviderSchema,
} from './shared.schemas';

// ============================================
// SHARED LOCAL/REMOTE FIELDS
// Common fields between local and remote modes
// ============================================

const sharedAuthFields = {
  local: localSigningConfigSchema.optional(),
  tokenStorage: tokenStorageConfigSchema.default('memory'),
  // #470 — backing for the general session secure-secret store (`this.secureStore`).
  // Optional (no default) so an unset value resolves to the in-memory encrypted
  // default at runtime; existing configs are unaffected.
  secureStore: secureStoreConfigSchema.optional(),
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
// LOCAL LOGIN CUSTOMIZATION + authenticate()
// (Checkpoint 3a — pluggable local-auth foundation)
// ============================================

/**
 * A single declarative login field. Functions are not used here, so this is a
 * plain object schema (no `z.custom`).
 */
const loginFieldSchema = z.object({
  type: z.enum(['text', 'password', 'email', 'select', 'hidden']),
  label: z.string().optional(),
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
});

/**
 * Local login-page customization. `render` and per-field defaults are passthrough
 * (no functions to validate beyond `render` itself, which is `z.custom`).
 */
export const loginConfigSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  logoUri: z.string().optional(),
  fields: z.record(z.string(), loginFieldSchema).optional(),
  // Full HTML override — a function, validated structurally like other callbacks
  // in the codebase (see http/cors handlers using z.custom<…>).
  render: z
    .custom<(ctx: LoginRenderContext) => string>((v) => typeof v === 'function', {
      message: 'login.render must be a function',
    })
    .optional(),
  subject: z
    .object({
      fromField: z.string().optional(),
      strategy: z.enum(['per-session', 'per-account']).optional(),
    })
    .optional(),
});

/**
 * Custom verification callback. Validated structurally (`typeof === 'function'`)
 * exactly like the existing http handler / cors callback schemas, since Zod
 * cannot validate the async signature at parse time.
 */
export const authenticateFnSchema = z.custom<AuthenticateFn>((v) => typeof v === 'function', {
  message: 'authenticate must be a function',
});

// ============================================
// LOCAL AUTH MODE (formerly orchestrated local)
// ============================================

export const localAuthSchema = z.object({
  mode: z.literal('local'),
  ...sharedAuthFields,
  // #468 — opt-out of the email requirement at /oauth/callback for
  // single-operator local setups. Defaults preserve the historical behavior
  // (email required) so existing configs are unaffected.
  requireEmail: z.boolean().default(true),
  anonymousSubject: z.string().min(1).default('local-operator'),
  // Checkpoint 3a — declarative login customization + custom verification.
  // Both optional; omitting them preserves the default login path exactly.
  login: loginConfigSchema.optional(),
  authenticate: authenticateFnSchema.optional(),
  // Multi-OAuth-provider orchestration — declare upstream providers (GitHub,
  // Slack, Jira, …) to federate at /oauth/authorize. Optional; omitting it
  // preserves the default single-operator local login exactly.
  providers: z.array(upstreamProviderSchema).optional(),
  // Local-AS Dynamic Client Registration control surface (#462) — gate
  // `POST /oauth/register`, allowlist redirect_uris/client_ids, require an
  // initial access token, and seed pre-registered trusted clients. Optional;
  // omitting it preserves today's behavior exactly (DCR on in dev, off in prod;
  // no allowlist; no initial access token).
  dcr: localDcrConfigSchema.optional(),
} satisfies RawZodShape<LocalAuthOptionsInterface>);

// ============================================
// REMOTE AUTH MODE (formerly orchestrated remote)
// ============================================

export const remoteAuthSchema = z.object({
  mode: z.literal('remote'),
  ...flatRemoteProviderFields,
  ...sharedAuthFields,
} satisfies RawZodShape<RemoteAuthOptionsInterface>);

// ============================================
// TYPE EXPORTS
// ============================================

export type LocalAuthOptions = z.infer<typeof localAuthSchema>;
export type LocalAuthOptionsInput = LocalAuthOptionsInterface;

export type RemoteAuthOptions = z.infer<typeof remoteAuthSchema>;
export type RemoteAuthOptionsInput = RemoteAuthOptionsInterface;

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
