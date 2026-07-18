// options/orchestrated.schema.ts
// Local and Remote auth modes (formerly orchestrated local/remote)

import { z } from '@frontmcp/lazy-zod';

import type { RawZodShape } from '../common/zod-utils';
import type {
  AuthenticateFn,
  AuthExtraHandler,
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

/**
 * The five custom auth-UI slots. A slot is a KEY in the {@link authUiMapSchema};
 * its value is the relative `.tsx`/`.jsx` path resolved against the config file.
 */
const authSlotSchema = z.enum(['login', 'consent', 'incremental', 'federated', 'error']);

/**
 * `auth.ui` — a slot → relative component file map (#469, map form). Replaces
 * the old `@AuthUi`-class array. The path resolution (relative to the declaring
 * `@FrontMcp`/`@App` source dir vs absolute pass-through) happens at registry
 * build time, not at parse time, so this only validates the shape.
 *
 * `partialRecord` (not `record`) so every slot is OPTIONAL — `z.record(enum, …)`
 * in Zod 4 would otherwise require ALL five slots. Slots are opt-in: only the
 * ones you declare override the built-in page.
 */
const authUiMapSchema = z.partialRecord(authSlotSchema, z.string().min(1));

/**
 * `auth.extras` — an extra name → handler function map (#469, map form).
 * Replaces the old `@AuthExtra`-class array. Validated structurally
 * (`typeof === 'function'`) exactly like the other callback schemas in this
 * file (`authenticate`, `login.render`), since Zod cannot validate the async
 * signature at parse time.
 */
const authExtraHandlerSchema = z.custom<AuthExtraHandler>((v) => typeof v === 'function', {
  message: 'auth.extras entries must be handler functions (input, ctx) => AuthExtraResult.',
});
const authExtrasMapSchema = z.record(z.string().min(1), authExtraHandlerSchema);

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
  /**
   * Require the OAuth client to be KNOWN (registered via DCR / pre-registered,
   * or a CIMD client-id URL) before an authorization request is accepted.
   *
   * @default false (backward compatible — unknown client ids are accepted).
   *
   * SECURITY: with the default, an unregistered client id has no trusted
   * `redirect_uris` to validate against, so its (attacker-chosen) redirect_uri
   * is accepted and a real authorization code can be delivered to an attacker
   * (auth-code interception → account takeover in real-IdP modes). Set this to
   * `true` (recommended for production) to enforce OAuth 2.1 exact redirect-uri
   * matching for every client. Clients on a configured
   * `dcr.allowedRedirectUris` allowlist still pass.
   */
  requireRegisteredClients: z.boolean().default(false),
  cimd: cimdConfigSchema.optional(),
  // #469 — custom auth UI as a slot→file map + extras name→handler map (per-app
  // under splitByApp). Both optional; omitting them serves the built-in pages.
  ui: authUiMapSchema.optional(),
  extras: authExtrasMapSchema.optional(),
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
