// options/interfaces.ts
// Explicit TypeScript interfaces for better IDE autocomplete
//
// These interfaces mirror the Zod schemas but provide better autocomplete
// experience in IDEs. The schemas in *.schema.ts files are used for runtime
// validation, while these interfaces are used for type hints.
//
// IMPORTANT: Keep these interfaces in sync with the Zod schemas.
// The typecheck.ts file will fail to compile if they get out of sync.

import type { CimdConfigInput } from '../cimd';
import type { AuthLogger } from '../common';
import { type JSONWebKeySet, type JWK } from '../common/jwt.types';
import type { RedisConfig } from '../session/transport-session.types';

// ============================================
// SHARED CONFIG INTERFACES
// ============================================

/**
 * Public access configuration for tools/prompts
 */
export interface PublicAccessConfig {
  /**
   * Allow all tools or explicit whitelist
   * @default 'all'
   */
  tools?: 'all' | string[];

  /**
   * Allow all prompts or explicit whitelist
   * @default 'all'
   */
  prompts?: 'all' | string[];

  /**
   * Rate limit per IP per minute
   * @default 60
   */
  rateLimit?: number;
}

/**
 * Local signing configuration
 */
export interface LocalSigningConfig {
  /**
   * Private key for signing tokens
   * @default auto-generated
   */
  signKey?: JWK | Uint8Array;

  /**
   * JWKS for token verification
   * @default auto-generated
   */
  jwks?: JSONWebKeySet;

  /**
   * Issuer identifier for tokens
   * @default auto-derived from server URL
   */
  issuer?: string;
}

/**
 * Advanced provider configuration (optional sub-object)
 */
export interface ProviderConfig {
  /** Provider display name */
  name?: string;

  /**
   * Unique identifier for this provider
   * @default derived from provider URL
   */
  id?: string;

  /**
   * Inline JWKS for offline token verification
   * Falls back to fetching from provider's /.well-known/jwks.json
   */
  jwks?: JSONWebKeySet;

  /** Custom JWKS URI if not at standard path */
  jwksUri?: string;

  /**
   * Enable Dynamic Client Registration (DCR)
   * @default false
   */
  dcrEnabled?: boolean;

  /** Authorization endpoint override */
  authEndpoint?: string;

  /** Token endpoint override */
  tokenEndpoint?: string;

  /** Registration endpoint override (for DCR) */
  registrationEndpoint?: string;

  /** User info endpoint override */
  userInfoEndpoint?: string;
}

/**
 * Remote OAuth provider configuration (legacy full shape, kept for internal use)
 */
export interface RemoteProviderConfig {
  /**
   * OAuth provider base URL
   * @example 'https://auth.example.com'
   */
  provider: string;

  /** Provider display name */
  name?: string;

  /**
   * Unique identifier for this provider
   * @default derived from provider URL
   */
  id?: string;

  /**
   * Inline JWKS for offline token verification
   * Falls back to fetching from provider's /.well-known/jwks.json
   */
  jwks?: JSONWebKeySet;

  /** Custom JWKS URI if not at standard path */
  jwksUri?: string;

  /** Client ID for this MCP server */
  clientId?: string;

  /** Client secret (for confidential clients) */
  clientSecret?: string;

  /** Scopes to request from the upstream provider */
  scopes?: string[];

  /**
   * Enable Dynamic Client Registration (DCR)
   * @default false
   */
  dcrEnabled?: boolean;

  /** Authorization endpoint override */
  authEndpoint?: string;

  /** Token endpoint override */
  tokenEndpoint?: string;

  /** Registration endpoint override (for DCR) */
  registrationEndpoint?: string;

  /** User info endpoint override */
  userInfoEndpoint?: string;
}

/**
 * SQLite configuration for token storage.
 *
 * `path` is required: the auth layer has no default-path resolver, so SQLite
 * persistence is opt-in and explicit.
 */
export interface TokenStorageSqliteConfig {
  /** Path to the `.sqlite` database file used for auth persistence. */
  path: string;
  /** Optional at-rest value encryption (AES-256-GCM via HKDF-SHA256). */
  encryption?: { secret: string };
  /** Interval in ms for purging expired keys (default 60000). */
  ttlCleanupIntervalMs?: number;
  /** Enable WAL mode for better read concurrency (default true). */
  walMode?: boolean;
}

/**
 * Token storage configuration (simplified, BC-030)
 *
 * - `'memory'` — in-memory storage (default; lost on restart).
 * - `{ redis: RedisConfig }` — Redis-backed persistence.
 * - `{ sqlite: TokenStorageSqliteConfig }` — local SQLite-file persistence.
 */
export type TokenStorageConfig = 'memory' | { redis: RedisConfig } | { sqlite: TokenStorageSqliteConfig };

// ============================================
// SECURE STORE CONFIG (#470)
// ============================================

/**
 * How a secure-store namespace is derived from the request:
 * - `user` (default): keyed by the authenticated subject (`sub`).
 * - `session`: keyed by the transport `sessionId`.
 * - `global`: a single server-wide namespace.
 */
export type SecureStoreScope = 'user' | 'session' | 'global';

/**
 * At-rest encryption settings for the built-in secure-store backings. Ignored
 * for a custom `{ backend }` backing.
 */
export interface SecureStoreEncryptionConfig {
  /** Server pepper mixed into HKDF key derivation. Defaults to `VAULT_SECRET ?? JWT_SECRET`. */
  pepper?: string;
}

/**
 * A custom secure-store backing — an object implementing the four-method
 * `SecureStoreBackend` contract (e.g. an OS-keychain backend). Typed loosely
 * here (the strict `SecureStoreBackend` interface lives in `session/`) so the
 * options module stays free of session imports.
 */
export interface SecureStoreCustomBackend {
  get(namespace: string, key: string): Promise<string | null>;
  set(namespace: string, key: string, value: string, ttlMs?: number): Promise<void>;
  delete(namespace: string, key: string): Promise<boolean>;
  list(namespace: string): Promise<string[]>;
  dispose?(): Promise<void>;
}

/** Fields shared by the object-form secure-store configs. */
interface SecureStoreCommonConfig {
  /** Namespace scope. @default 'user' */
  scope?: SecureStoreScope;
  /** Default TTL (ms) for stored secrets. @default undefined (no expiry) */
  ttlMs?: number;
  /** At-rest encryption settings (built-in backings only). */
  encryption?: SecureStoreEncryptionConfig;
}

/**
 * Secure-store configuration (#470) — the general session-scoped secure-secret
 * store backing for `this.secureStore`.
 *
 * - `'memory'` — in-memory, AES-256-GCM-encrypted (default; lost on restart).
 * - `{ sqlite }` — local SQLite-file persistence (survives restart).
 * - `{ redis }` — Redis-backed persistence.
 * - `{ backend }` — a custom backing (e.g. an OS keychain). No native dependency
 *   is bundled by the framework.
 *
 * The object forms also accept `scope`, `ttlMs`, and (for built-ins) `encryption`.
 */
export type SecureStoreConfig =
  | 'memory'
  | (SecureStoreCommonConfig & { sqlite?: never; redis?: never; backend?: never })
  | (SecureStoreCommonConfig & { sqlite: TokenStorageSqliteConfig })
  | (SecureStoreCommonConfig & { redis: RedisConfig })
  | (SecureStoreCommonConfig & { backend: SecureStoreCustomBackend });

/**
 * Token refresh configuration
 */
export interface TokenRefreshConfig {
  /**
   * Enable automatic token refresh
   * @default true
   */
  enabled?: boolean;

  /**
   * Refresh token before expiry by this many seconds
   * @default 60
   */
  skewSeconds?: number;
}

/**
 * Behavior when a tool from a skipped (not yet authorized) app is called
 */
export type SkippedAppBehavior = 'anonymous' | 'require-auth';

/**
 * Consent configuration for tool selection
 */
export interface ConsentConfig {
  /**
   * Enable consent flow for tool selection
   * @default false
   */
  enabled?: boolean;

  /**
   * Group tools by app in the consent UI
   * @default true
   */
  groupByApp?: boolean;

  /**
   * Show tool descriptions in consent UI
   * @default true
   */
  showDescriptions?: boolean;

  /**
   * Allow selecting all tools at once
   * @default true
   */
  allowSelectAll?: boolean;

  /**
   * Require at least one tool to be selected
   * @default true
   */
  requireSelection?: boolean;

  /** Custom message to display on consent page */
  customMessage?: string;

  /**
   * Remember consent for future sessions
   * @default true
   */
  rememberConsent?: boolean;

  /** Tools to exclude from consent (always available) */
  excludedTools?: string[];

  /** Tools to always include in consent (pre-selected) */
  defaultSelectedTools?: string[];
}

/**
 * Federated authentication configuration
 */
export interface FederatedAuthConfig {
  /**
   * How strictly to validate the OAuth state parameter on provider callbacks.
   * - 'strict': Validates the full state parameter matches the session (recommended)
   * - 'format': Only validates the state format is correct
   */
  stateValidation: 'strict' | 'format';

  /**
   * Minimum number of upstream providers a user must link before a FrontMCP JWT
   * is minted (defaults to 1 at runtime when `providers` are configured).
   */
  minProviders?: number;

  /**
   * Provider ids that MUST be linked before a JWT is minted.
   */
  requiredProviders?: string[];
}

/**
 * Declarative upstream OAuth provider for local-mode multi-provider
 * orchestration. See {@link LocalAuthOptionsInterface.providers}.
 */
export interface UpstreamProviderOptions {
  /** Stable provider id (e.g. `'github'`). */
  id: string;
  /** Human-readable display name. Defaults to `id`. */
  name?: string;
  /** Authorization endpoint (canonical name). */
  authorizationEndpoint?: string;
  /** Authorization endpoint (alias for {@link authorizationEndpoint}). */
  authorizeUrl?: string;
  /** Token endpoint (canonical name). */
  tokenEndpoint?: string;
  /** Token endpoint (alias for {@link tokenEndpoint}). */
  tokenUrl?: string;
  /** OAuth client id issued by the upstream provider. */
  clientId: string;
  /** OAuth client secret (confidential clients). */
  clientSecret?: string;
  /** Scopes to request from the upstream provider. */
  scopes?: string[];
  /** User info endpoint (optional). */
  userInfoEndpoint?: string;
  /** JWKS URI for upstream id_token validation (optional). */
  jwksUri?: string;
}

/**
 * A pre-registered (trusted) OAuth client for the LOCAL Authorization Server.
 * Seeded into the client registry at startup so the authorize/token flows
 * accept it without a Dynamic Client Registration round-trip. See
 * {@link LocalDcrConfig.clients}. No PII is stored — only OAuth client metadata.
 */
export interface LocalDcrClient {
  /** Stable, pre-assigned client identifier. */
  clientId: string;
  /** Confidential-client secret. Omit for public (PKCE) clients. */
  clientSecret?: string;
  /** Exact redirect URIs this client may use (at least one). */
  redirectUris: string[];
  /** Human-readable client name for consent/login screens. */
  clientName?: string;
  /**
   * Token-endpoint auth method.
   * @default 'none'
   */
  tokenEndpointAuthMethod?: 'none' | 'client_secret_basic' | 'client_secret_post';
  /**
   * Allowed grant types.
   * @default ['authorization_code']
   */
  grantTypes?: Array<'authorization_code' | 'refresh_token'>;
  /**
   * Allowed response types.
   * @default ['code']
   */
  responseTypes?: Array<'code'>;
  /** Optional space-delimited default scope string. */
  scope?: string;
}

/**
 * Declarative control surface for the LOCAL Authorization Server's Dynamic
 * Client Registration endpoint (`POST /oauth/register`) and client allowlist.
 *
 * IMPORTANT: distinct from the upstream-provider `dcrEnabled`/
 * `registrationEndpoint` fields on {@link ProviderConfig}/
 * {@link RemoteProviderConfig} (those register THIS server against an upstream
 * IdP and are not read by the local AS). Every field is optional; omitting the
 * whole `dcr` block preserves the historical behavior exactly (DCR enabled in
 * dev, disabled in production; no allowlist; no initial access token).
 */
export interface LocalDcrConfig {
  /**
   * Whether `POST /oauth/register` is active and `registration_endpoint` is
   * advertised. When unset, the historical guard applies (on in dev, off in
   * production).
   */
  enabled?: boolean;
  /**
   * Redirect-URI allowlist (exact match or simple `*` glob). When set, both DCR
   * registrations and `/oauth/authorize` reject a `redirect_uri` not on the
   * list. When unset, no redirect_uri allowlist is enforced.
   */
  allowedRedirectUris?: string[];
  /**
   * Client-id allowlist. When set, only these ids may register or be used at
   * `/oauth/authorize` (CIMD URL client ids are exempt). When unset, any id is
   * accepted subject to the other checks.
   */
  allowedClientIds?: string[];
  /**
   * Initial Access Token (RFC 7591 §3). When set, `POST /oauth/register`
   * requires a matching `Authorization: Bearer <token>` header. When unset,
   * registration is unauthenticated (historical behavior).
   */
  initialAccessToken?: string;
  /**
   * Pre-registered trusted clients seeded at startup. Accepted by the
   * authorize/token flows without a DCR round-trip.
   */
  clients?: LocalDcrClient[];
}

/**
 * Progressive/Incremental authorization configuration
 */
export interface IncrementalAuthConfig {
  /**
   * Enable incremental (progressive) authorization
   * @default true
   */
  enabled?: boolean;

  /**
   * Behavior when a tool from a skipped app is called
   * @default 'anonymous'
   */
  skippedAppBehavior?: SkippedAppBehavior;

  /**
   * Allow users to skip app authorization during initial auth flow
   * @default true
   */
  allowSkip?: boolean;

  /**
   * Show all apps in a single authorization page (vs step-by-step)
   * @default true
   */
  showAllAppsAtOnce?: boolean;
}

// ============================================
// LOCAL LOGIN CUSTOMIZATION + authenticate()
// (Checkpoint 3a — pluggable local-auth foundation)
// ============================================

/**
 * A single custom field rendered on the local-mode login page.
 *
 * Fields are declarative: FrontMCP renders them on the default login page and
 * forwards their submitted values to {@link LocalAuthOptionsInterface.authenticate}
 * as `input.fields`. No PII is persisted by FrontMCP — fields are passed
 * through to your verifier and never stored.
 */
export interface LoginFieldConfig {
  /** HTML input type. `hidden` fields are submitted but not shown. */
  type: 'text' | 'password' | 'email' | 'select' | 'hidden';
  /** Field label shown above the input. Defaults to the field key. */
  label?: string;
  /** Whether the browser should require a value before submit. */
  required?: boolean;
  /** Placeholder text for text/email/password inputs. */
  placeholder?: string;
  /** Options for a `select` field. Ignored for other types. */
  options?: Array<{ value: string; label: string }>;
}

/**
 * Subject derivation strategy for local logins.
 *
 * - `per-session` (default): every login yields a fresh subject (stateless).
 * - `per-account`: the value of {@link LoginSubjectConfig.fromField} is hashed
 *   into a stable subject so the same account maps to the same `sub`.
 */
export interface LoginSubjectConfig {
  /** Login field whose submitted value seeds a stable subject. */
  fromField?: string;
  /** How the subject is derived. @default 'per-session' */
  strategy?: 'per-session' | 'per-account';
}

/**
 * Declarative customization of the built-in local-mode login page.
 *
 * Set any of these to tailor the default `/oauth/authorize` login page without
 * replacing the OAuth flow. When `render` is provided it fully overrides the
 * built-in page; otherwise `fields` extend the default email/name form.
 */
export interface LoginConfig {
  /** Page heading. Defaults to "Sign In". */
  title?: string;
  /** Sub-heading shown under the title. */
  subtitle?: string;
  /** Logo image URL shown above the form. */
  logoUri?: string;
  /**
   * Extra fields appended to the login form, keyed by field name. The
   * submitted values are forwarded to {@link LocalAuthOptionsInterface.authenticate}
   * as `input.fields[name]`.
   */
  fields?: Record<string, LoginFieldConfig>;
  /**
   * Full HTML override for the login page. Receives a {@link LoginRenderContext}
   * and must return a complete HTML document string. When set, `title`,
   * `subtitle`, `logoUri`, and `fields` are NOT auto-rendered — you own the markup.
   */
  render?: (ctx: LoginRenderContext) => string;
  /** Controls how the authenticated subject (`sub`) is derived. */
  subject?: LoginSubjectConfig;
}

/**
 * Context passed to a custom {@link LoginConfig.render} function. Carries the
 * client identity (CIMD `client_name`/`logo_uri` when available), requested
 * scopes, the pending-authorization id (must be submitted back), the callback
 * path to POST/GET to, the declared {@link LoginConfig.fields}, and a previous
 * error message (set when {@link AuthenticateResult} failed and the page is
 * being re-rendered).
 */
export interface LoginRenderContext {
  /** OAuth client_id (or CIMD URL) of the requesting client. */
  clientId: string;
  /** Human-readable client name (CIMD `client_name` when available, else clientId). */
  clientName: string;
  /** CIMD `logo_uri` when available. */
  logoUri?: string;
  /** Requested OAuth scopes. */
  scopes: string[];
  /** Pending-authorization id; MUST be submitted back as `pending_auth_id`. */
  pendingAuthId: string;
  /** Path the login form should submit to (the `/oauth/callback` endpoint). */
  callbackPath: string;
  /** The declared custom login fields (may be empty). */
  fields: Record<string, LoginFieldConfig>;
  /** Error message to display when re-rendering after a failed authenticate(). */
  error?: string;
  /**
   * Submitted field values to pre-fill on re-render (set when the page is
   * re-rendered after a failed authenticate()). Keyed by field name.
   */
  values?: Record<string, string>;
}

/**
 * Input handed to {@link LocalAuthOptionsInterface.authenticate}: the submitted
 * login-field values keyed by field name. Built-in `email`/`name` fields are
 * included alongside any declared custom {@link LoginConfig.fields}.
 */
export interface AuthenticateInput {
  /** Submitted login-field values keyed by field name. */
  fields: Record<string, string>;
  /**
   * Present only when `authenticate()` is re-invoked from a mid-session
   * add-credential flow (Checkpoint 3b). Carries the framework-verified subject,
   * the credential key being connected, and the optional opaque context from the
   * original `requireConnect({ key, context })` call. When set, the verifier
   * should return `{ ok: true, credentials: [{ key, secret, … }] }` to ADD the
   * credential to the existing session vault (a new token is NOT minted).
   */
  resume?: {
    /** Framework-verified subject the credential is being connected for. */
    sub: string;
    /** Credential key being connected. */
    key: string;
    /** Optional opaque context forwarded from `requireConnect`. */
    context?: string;
  };
}

/**
 * Context handed to {@link LocalAuthOptionsInterface.authenticate}. Provides DI
 * access (`get`), a `fetch` for outbound calls, a scoped `logger`, and the
 * requesting client's identity.
 */
export interface AuthenticateContext {
  /** Resolve a provider/service from the DI container. */
  get<T>(token: unknown): T;
  /** Outbound fetch (use for verifying credentials against an upstream API). */
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  /** Scoped logger for diagnostics. */
  logger: AuthLogger;
  /** OAuth client_id (or CIMD URL) of the requesting client, when known. */
  clientId?: string;
  /** Human-readable client name (CIMD `client_name`), when known. */
  clientName?: string;
}

/**
 * A credential the verifier wants FrontMCP to persist for the session.
 *
 * Persisted (Checkpoint 3b) into the built-in, AES-256-GCM-encrypted, per-session
 * credential vault keyed by the authenticated `sub`, and exposed to tools via
 * `this.credentials.get(key)` / `list()` / `requireConnect({ key })`. The vault
 * is enabled automatically in `local` (and `remote`) modes; a fresh authorize
 * rotates the vault so a reconnect starts empty.
 */
export interface AuthenticateCredential {
  /** Stable key the credential is stored under (e.g. provider id). */
  key: string;
  /** The secret value (token, api key, …). */
  secret: string;
  /** Optional non-secret metadata stored alongside the credential. */
  metadata?: Record<string, unknown>;
}

/**
 * Result of a successful local {@link LocalAuthOptionsInterface.authenticate}.
 */
export interface AuthenticateSuccess {
  ok: true;
  /** Explicit subject. When omitted, the subject is derived from the login subject strategy / anonymousSubject. */
  sub?: string;
  /** Custom claims to embed in the minted access token (namespaced to avoid clobbering reserved claims). */
  claims?: Record<string, unknown>;
  /** Per-session credentials to persist into the encrypted vault (`this.credentials`) — see {@link AuthenticateCredential}. */
  credentials?: AuthenticateCredential[];
  /** Optional informational message. */
  message?: string;
}

/**
 * Result of a failed local {@link LocalAuthOptionsInterface.authenticate}. The
 * login page is re-rendered with `message` shown to the user.
 */
export interface AuthenticateFailure {
  ok: false;
  /** Error message shown on the re-rendered login page. */
  message: string;
  /** Optional field name to focus/highlight on the re-rendered page. */
  retryField?: string;
}

/**
 * Discriminated union returned by {@link LocalAuthOptionsInterface.authenticate}.
 */
export type AuthenticateResult = AuthenticateSuccess | AuthenticateFailure;

/**
 * Custom verification step for local-mode logins.
 *
 * Receives the submitted login fields and a {@link AuthenticateContext}; returns
 * `{ ok: true, sub?, claims?, credentials? }` to mint a token, or
 * `{ ok: false, message, retryField? }` to reject the login and re-render the
 * page. When `authenticate` is configured, the built-in email requirement no
 * longer applies (the verifier decides what is required via its `fields`).
 */
export type AuthenticateFn = (input: AuthenticateInput, ctx: AuthenticateContext) => Promise<AuthenticateResult>;

// ============================================
// AUTH MODE INTERFACES
// ============================================

export interface PublicAuthOptionsInterface {
  mode: 'public';
  issuer?: string;
  sessionTtl?: number;
  anonymousScopes?: string[];
  publicAccess?: PublicAccessConfig;
  jwks?: JSONWebKeySet;
  signKey?: JWK | Uint8Array;
}

export interface TransparentAuthOptionsInterface {
  mode: 'transparent';
  provider: string;
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
  providerConfig?: ProviderConfig;
  expectedAudience?: string | string[];
  requiredScopes?: string[];
  allowAnonymous?: boolean;
  anonymousScopes?: string[];
  publicAccess?: PublicAccessConfig;
}

export interface LocalAuthOptionsInterface {
  mode: 'local';
  local?: LocalSigningConfig;
  tokenStorage?: TokenStorageConfig;
  /**
   * Backing for the general session-scoped secure-secret store (`this.secureStore`,
   * #470). Selects memory / sqlite / redis / a custom (e.g. OS-keychain) backend,
   * plus the namespace `scope`. Optional — omitting it defaults to an in-memory,
   * AES-256-GCM-encrypted, `user`-scoped store.
   *
   * @see SecureStoreConfig
   */
  secureStore?: SecureStoreConfig;
  allowDefaultPublic?: boolean;
  anonymousScopes?: string[];
  publicAccess?: PublicAccessConfig;
  consent?: ConsentConfig;
  federatedAuth?: FederatedAuthConfig;
  refresh?: TokenRefreshConfig;
  expectedAudience?: string | string[];
  incrementalAuth?: IncrementalAuthConfig;
  cimd?: CimdConfigInput;
  /**
   * Require an email at the `/oauth/callback` login step.
   *
   * When `true` (default) the callback rejects a non-incremental login that
   * carries no email — the historical behavior. Set to `false` for
   * single-operator local setups (e.g. Claude Code against `mode: 'local'`)
   * where a login should mint a code without prompting for an email; the
   * callback then derives a stable anonymous `sub` from
   * {@link LocalAuthOptionsInterface.anonymousSubject}.
   *
   * @default true
   */
  requireEmail?: boolean;
  /**
   * Stable subject identifier used to mint the authorization code when
   * {@link LocalAuthOptionsInterface.requireEmail} is `false` and no email is
   * provided. Defaults to `'local-operator'`. The same value always maps to
   * the same `sub`, so the single operator keeps a stable identity.
   *
   * @default 'local-operator'
   */
  anonymousSubject?: string;
  /**
   * Declarative customization of the built-in local login page (title,
   * subtitle, logo, extra fields, full HTML override, and subject strategy).
   * Optional — omitting it preserves the default email/name login form exactly.
   *
   * @see LoginConfig
   */
  login?: LoginConfig;
  /**
   * Custom verification step run at `/oauth/callback` before a token is minted.
   * Receives the submitted login fields and returns `{ ok: true, … }` to mint a
   * token (optionally with an explicit `sub` and custom `claims`) or
   * `{ ok: false, message }` to reject and re-render the login page.
   *
   * When set, the built-in email requirement (`requireEmail`) no longer applies.
   * Omitting it preserves the default email/anonymous login path exactly.
   *
   * @see AuthenticateFn
   */
  authenticate?: AuthenticateFn;
  /**
   * Upstream OAuth providers (GitHub, Slack, Jira, …) to orchestrate in local
   * mode. When declared, FrontMCP federates them at `/oauth/authorize`, refuses
   * to mint a JWT until the {@link FederatedAuthConfig.minProviders} threshold
   * (default 1) is met, stores each provider's tokens encrypted, and exposes
   * them to tools via `this.orchestration.getToken(id)`. Optional — omitting it
   * preserves the default single-operator local login exactly.
   *
   * @see UpstreamProviderOptions
   */
  providers?: UpstreamProviderOptions[];
  /**
   * Local Authorization Server Dynamic Client Registration control surface
   * (#462): gate `POST /oauth/register`, allowlist redirect URIs / client ids,
   * require an initial access token, and seed pre-registered trusted clients.
   * Optional — omitting it preserves today's behavior exactly (DCR on in dev,
   * off in production; no allowlist; no initial access token).
   *
   * @see LocalDcrConfig
   */
  dcr?: LocalDcrConfig;
}

export interface RemoteAuthOptionsInterface {
  mode: 'remote';
  provider: string;
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
  providerConfig?: ProviderConfig;
  local?: LocalSigningConfig;
  tokenStorage?: TokenStorageConfig;
  /**
   * Backing for the general session-scoped secure-secret store (`this.secureStore`,
   * #470). See {@link SecureStoreConfig}. Optional — defaults to an in-memory,
   * AES-256-GCM-encrypted, `user`-scoped store.
   */
  secureStore?: SecureStoreConfig;
  allowDefaultPublic?: boolean;
  anonymousScopes?: string[];
  publicAccess?: PublicAccessConfig;
  consent?: ConsentConfig;
  federatedAuth?: FederatedAuthConfig;
  refresh?: TokenRefreshConfig;
  expectedAudience?: string | string[];
  incrementalAuth?: IncrementalAuthConfig;
  cimd?: CimdConfigInput;
}

// ============================================
// UNIFIED AUTH OPTIONS INTERFACE
// ============================================

export type AuthOptionsInterface =
  | PublicAuthOptionsInterface
  | TransparentAuthOptionsInterface
  | LocalAuthOptionsInterface
  | RemoteAuthOptionsInterface;

export type LocalOrRemoteAuthOptionsInterface = LocalAuthOptionsInterface | RemoteAuthOptionsInterface;

export type AuthMode = 'public' | 'transparent' | 'local' | 'remote';

// ============================================
// BACKWARDS COMPAT ALIASES (deprecated)
// ============================================

/** @deprecated Use LocalAuthOptionsInterface */
export type OrchestratedLocalOptionsInterface = LocalAuthOptionsInterface;
/** @deprecated Use RemoteAuthOptionsInterface */
export type OrchestratedRemoteOptionsInterface = RemoteAuthOptionsInterface;
/** @deprecated Use LocalOrRemoteAuthOptionsInterface */
export type OrchestratedAuthOptionsInterface = LocalOrRemoteAuthOptionsInterface;
/** @deprecated Removed - modes are now 'local' | 'remote' */
export type OrchestratedType = 'local' | 'remote';
