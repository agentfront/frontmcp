import { jwtVerify, SignJWT } from 'jose';

import {
  createSecureStore,
  createTokenStorageAdapter,
  DcrClientRegistry,
  deriveAuthorizationId,
  InMemoryAuthorizationStore,
  InMemoryConsentStore,
  InMemoryFederatedAuthSessionStore,
  InMemoryOrchestratedTokenStore,
  isPersistentTokenStorage,
  isRedisTokenStorage,
  isSqliteTokenStorage,
  JwksService,
  SessionCredentialVault,
  StorageAuthorizationStore,
  StorageConsentStore,
  StorageFederatedAuthSessionStore,
  StorageOrchestratedTokenStore,
  TokenNotAvailableError,
  verifyPkce,
  type AuthorizationStore,
  type ConsentStore,
  type DcrRegistryConfig,
  type FederatedAuthSessionStore,
  type JSONWebKeySet,
  type SecureStoreBackend,
  type SecureStoreConfig,
  type TokenRefreshCallback,
  type TokenStorageConfig,
  type OrchestratedTokenStore as TokenStore,
  type VerifyResult,
} from '@frontmcp/auth';
import {
  getEnv,
  isProduction,
  MemoryStorageAdapter,
  randomBytes,
  randomUUID,
  StorageNotSupportedError,
  type StorageAdapter,
} from '@frontmcp/utils';

import {
  computeIssuer,
  defaultHttpPort,
  FrontMcpAuth,
  getPinnedPublicUrl,
  ProviderScope,
  resourceUriMatches,
  type FrontMcpLogger,
  type JWK,
  type ScopeEntry,
  type ServerRequest,
} from '../../common';
import {
  isLocalMode,
  isOrchestratedMode,
  isPublicMode,
  isRemoteMode,
  type LocalAuthOptions,
  type PublicAuthOptions,
  type RemoteAuthOptions,
  type StaticAuthOptions,
} from '../../common/types/options/auth';
import { installContextExtensions } from '../../context/context-extension';
import { JwtSecretRequiredError, JwtSecretWeakError } from '../../errors';
import type ProviderRegistry from '../../provider/provider.registry';
import { CimdService } from '../cimd';
import { createCredentialsProviders } from '../credentials';
import { credentialsContextExtension } from '../credentials/credentials.context-extension';
import OauthAuthUiExtraFlow from '../flows/oauth.auth-ui.flow';
import OauthAuthorizeFlow from '../flows/oauth.authorize.flow';
import OauthCallbackFlow from '../flows/oauth.callback.flow';
import OauthConnectFlow from '../flows/oauth.connect.flow';
import OauthProviderCallbackFlow from '../flows/oauth.provider-callback.flow';
import OauthRegisterFlow from '../flows/oauth.register.flow';
import OauthTokenFlow from '../flows/oauth.token.flow';
import OauthUserInfoFlow from '../flows/oauth.userinfo.flow';
import SessionVerifyFlow from '../flows/session.verify.flow';
import WellKnownJwksFlow from '../flows/well-known.jwks.flow';
import WellKnownAsFlow from '../flows/well-known.oauth-authorization-server.flow';
import WellKnownPrmFlow from '../flows/well-known.prm.flow';
import { createSecureStoreProviders } from '../secure-store';
import { secureStoreContextExtension } from '../secure-store/secure-store.context-extension';

/**
 * Options type for LocalPrimaryAuth - can be public, orchestrated local, or orchestrated remote
 */
export type LocalPrimaryAuthOptions = PublicAuthOptions | StaticAuthOptions | LocalAuthOptions | RemoteAuthOptions;

// Lazily generated and memoized so importing this module has NO side effects —
// V8-isolate runtimes (Cloudflare Workers) forbid generating random values in
// global/module-eval scope. The constructor (which runs while a Scope is built,
// inside a request handler on Workers) calls this, where random is allowed.
/** RFC 7518 §3.2 — HS256 requires a key at least as long as the SHA-256 output. */
const MIN_HS256_SECRET_BYTES = 32;

let defaultNoAuthSecret: Uint8Array | undefined;
function getDefaultNoAuthSecret(): Uint8Array {
  if (!defaultNoAuthSecret) {
    defaultNoAuthSecret = randomBytes(32);
  }
  return defaultNoAuthSecret;
}

/**
 * User information for JWT claims
 */
export interface UserInfo {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  roles?: string[];
}

/**
 * Token response from the token endpoint
 */
export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

/**
 * Consent and federated login metadata for JWT claims
 */
export interface ConsentMetadata {
  selectedToolIds?: string[];
  selectedProviderIds?: string[];
  skippedProviderIds?: string[];
  consentEnabled?: boolean;
  federatedLoginUsed?: boolean;
  /**
   * Progressive/Incremental authorization: the set of app IDs this token grants
   * access to. ONLY emitted when `incrementalAuth` is enabled for the scope —
   * its presence turns on app-level gating in `checkToolAuthorization`, so it is
   * deliberately omitted for non-incremental setups to preserve the historical
   * allow-all behavior. Embedded as the `authorized_apps` claim by
   * {@link LocalPrimaryAuth.signAccessToken}.
   */
  authorizedAppIds?: string[];
  /**
   * Custom claims from a local `authenticate` verifier (Checkpoint 3a). Merged
   * into the access token by {@link LocalPrimaryAuth.signAccessToken} with a
   * reserved-claim guard so they can never clobber sub/iss/exp/etc.
   */
  customClaims?: Record<string, unknown>;
}

/**
 * Reserved JWT claim names that a custom `authenticate` verifier must never be
 * able to override. Any such keys in `customClaims` are dropped before signing.
 */
const RESERVED_JWT_CLAIMS = new Set<string>([
  'sub',
  'iss',
  'aud',
  'exp',
  'iat',
  'nbf',
  'jti',
  'scope',
  'email',
  'name',
  'picture',
  'roles',
  'consent',
  'federated',
  'authorized_apps',
]);

/**
 * Extended token response from upstream providers (includes id_token)
 */
export interface UpstreamTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

/**
 * Provider configuration for upstream OAuth providers
 */
export interface UpstreamProviderConfig {
  /** Provider ID */
  id: string;
  /** Display name */
  name: string;
  /** Authorization endpoint */
  authorizationEndpoint: string;
  /** Token endpoint */
  tokenEndpoint: string;
  /** User info endpoint (optional) */
  userInfoEndpoint?: string;
  /** JWKS URI for ID token validation (optional) */
  jwksUri?: string;
  /** Inline JWKS for ID token validation (optional; wins over `jwksUri`). */
  jwks?: JSONWebKeySet;
  /** Client ID */
  clientId: string;
  /** Client secret (for confidential clients) */
  clientSecret?: string;
  /** Default scopes to request */
  scopes: string[];
  /** Callback URL for this provider */
  callbackUrl: string;
  /**
   * The provider's issuer identifier, as recorded at configuration time.
   *
   * Used for two things added by MCP 2026-07-28:
   * - RFC 9207 validation — an `iss` present on the authorization response MUST
   *   match this before the code is redeemed (SEP-2468).
   * - Credential scoping — persisted client credentials are keyed by issuer and
   *   MUST NOT be reused with a different authorization server (SEP-2352).
   *
   * Optional because a provider may be configured by raw endpoints alone; when
   * absent the `iss` check is skipped (the parameter is only SHOULD-sent), and
   * the provider's `id_token` is not used for identity (its `iss` can't be
   * checked), unless `verifyIssuer` is explicitly `false`.
   */
  issuer?: string;
  /** Other issuer values this provider legitimately uses (`providerConfig.additionalIssuers`). */
  additionalIssuers?: string[];
  /** `false` turns off the issuer checks for this provider (`providerConfig.verifyIssuer`). */
  verifyIssuer?: boolean;
}

/**
 * Normalize an issuer identifier for comparison.
 *
 * Issuer identifiers are URLs, so `https://idp.example.com` and
 * `https://idp.example.com/` denote the same issuer.
 */
function normalizeIssuer(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * Validate an RFC 9207 `iss` authorization-response parameter.
 *
 * MCP 2026-07-28 (SEP-2468) makes this a client-side MUST: when the
 * authorization server returns `iss`, it has to match the issuer recorded for
 * the provider before the code is redeemed. Without it a mix-up attack can
 * swap in a code minted by a different (attacker-controlled) AS.
 *
 * A missing `iss` is accepted — the AS is only SHOULD-required to send it, so
 * rejecting would break every AS that has not adopted RFC 9207 yet.
 */
export function validateAuthorizationIssuer(
  received: string | undefined,
  expected: string | undefined,
  /** Other issuer values the provider is configured to use. */
  additional: readonly string[] = [],
): { ok: true } | { ok: false; reason: string } {
  if (received === undefined) return { ok: true };
  if (!expected) return { ok: true };

  const accepted = [expected, ...additional].map(normalizeIssuer);
  if (!accepted.includes(normalizeIssuer(received))) {
    return {
      ok: false,
      reason: `Authorization response issuer "${received}" does not match the configured issuer "${expected}"`,
    };
  }
  return { ok: true };
}

/**
 * Whether a token's `aud` (a string or a list) names one of the protected
 * resources `expected`, comparing RFC 8707 resource URIs (scheme/host case,
 * default ports and a trailing slash don't matter). A token without `aud` never
 * does, and neither does any token when `expected` is empty.
 */
function audienceMatchesResource(aud: unknown, expected: string | readonly string[]): boolean {
  const audiences = typeof aud === 'string' ? [aud] : Array.isArray(aud) ? aud : [];
  const resources = typeof expected === 'string' ? [expected] : expected;
  return audiences.some(
    (value) => typeof value === 'string' && resources.some((resource) => resourceUriMatches(value, resource)),
  );
}

/**
 * Whether a storage error means "this backend cannot do that", as opposed to a
 * transient failure. Only the former justifies falling back to another guard;
 * a transient error must fail closed.
 */
function isUnsupportedOperation(error: unknown): boolean {
  return error instanceof StorageNotSupportedError;
}

/** The origin of an absolute URL, or `undefined` for anything that isn't one. */
function originOf(value: string): string | undefined {
  try {
    const origin = new URL(value).origin;
    return origin === 'null' ? undefined : origin;
  } catch {
    return undefined;
  }
}

export class LocalPrimaryAuth extends FrontMcpAuth<LocalPrimaryAuthOptions> {
  readonly host: string;
  readonly port: number;
  /** The boot-time issuer: the configured one, else this server's listener address (see {@link issuerFor}). */
  readonly issuer: string;
  /** Whether `FRONTMCP_PUBLIC_HOST` names the boot-time issuer's host, pinning it for every request. */
  private readonly publicHostPinned: boolean;
  readonly keys: JWK[] = [];
  readonly secret: Uint8Array;
  readonly logger: FrontMcpLogger;
  private jwks = new JwksService();
  private cimdService: CimdService | undefined;

  /**
   * Token storage backend selected from `options.tokenStorage`.
   * - `'memory'` / undefined → in-memory stores (default; lost on restart).
   * - `{ redis }` / `{ sqlite }` → adapter-backed stores that survive restart.
   *
   * The three stores below are constructed in-memory synchronously in the
   * constructor (preserving the exact legacy default behavior). When a
   * persistent backend is configured, {@link initializeStores} swaps in the
   * StorageAdapter-backed implementations during async `initialize()`, before
   * the server signals ready.
   */
  private readonly tokenStorage: TokenStorageConfig | undefined;

  /** OAuth authorization-code / pending / refresh-token store. */
  private authorizationStoreImpl: AuthorizationStore;

  /** Federated auth session store for multi-provider flows. */
  private federatedSessionStoreImpl: FederatedAuthSessionStore;

  /** Token store for upstream provider tokens. */
  private orchestratedTokenStoreImpl: TokenStore;

  /** Remembered per-(user, client) consent selections (`rememberConsent`). */
  private consentStoreImpl: ConsentStore;

  /**
   * Local-AS Dynamic Client Registration registry (#462). Seeded with any
   * `dcr.clients` at construction so the authorize/token flows accept those
   * pre-registered clients without a DCR round-trip, and mutated by
   * `POST /oauth/register`. Always present (empty when no `dcr` is configured).
   */
  private readonly dcrClientRegistryImpl: DcrClientRegistry;

  /** Storage adapter backing the persistent stores (kept for disposal). */
  private storageAdapter?: StorageAdapter;

  /**
   * Replay guard for incremental-authorization tickets (GHSA-2c4g-9c8x-6m8g).
   * Shares the persistent adapter when one is configured so the guard holds
   * across a distributed deployment; falls back to a dedicated in-memory
   * adapter, matching how the credential vault selects its backing store.
   *
   * Holds the in-flight PROMISE, not the resolved adapter: two concurrent
   * claims for the same ticket must not each build their own store, or each
   * would write and read back its own nonce and both would win.
   */
  private ticketReplayStorage?: Promise<StorageAdapter>;

  /**
   * Per-session encrypted credential vault (Checkpoint 3b). Backs
   * `this.credentials` in tools and persists `authenticate()` credentials.
   * Constructed in {@link initialize} once the storage backend is known.
   */
  private credentialVaultImpl?: SessionCredentialVault;

  /** Per-session encrypted credential vault (Checkpoint 3b), if enabled. */
  get credentialVault(): SessionCredentialVault | undefined {
    return this.credentialVaultImpl;
  }

  /**
   * General session-scoped secure-secret store backend (#470). Backs
   * `this.secureStore` in tools. Constructed in {@link initialize} from
   * `auth.secureStore`; defaults to an in-memory, AES-256-GCM-encrypted backing.
   */
  private secureStoreBackendImpl?: SecureStoreBackend;

  /** General secure-store backend (#470), if enabled. */
  get secureStoreBackend(): SecureStoreBackend | undefined {
    return this.secureStoreBackendImpl;
  }

  /** OAuth authorization-code / pending / refresh-token store. */
  get authorizationStore(): AuthorizationStore {
    return this.authorizationStoreImpl;
  }

  /** Federated auth session store for multi-provider flows. */
  get federatedSessionStore(): FederatedAuthSessionStore {
    return this.federatedSessionStoreImpl;
  }

  /** Token store for upstream provider tokens. */
  get orchestratedTokenStore(): TokenStore {
    return this.orchestratedTokenStoreImpl;
  }

  /**
   * Remembered per-(user, client) consent selections, backing
   * `auth.consent.rememberConsent`. Shares the configured token-storage backend
   * (memory by default; Redis/SQLite when persistent storage is configured).
   */
  get consentStore(): ConsentStore {
    return this.consentStoreImpl;
  }

  /**
   * Local-AS Dynamic Client Registration registry (#462). Consulted by the
   * register/authorize flows to enforce the declarative `dcr` allowlists and to
   * look up pre-registered + dynamically-registered clients.
   */
  get dcrClientRegistry(): DcrClientRegistry {
    return this.dcrClientRegistryImpl;
  }

  /**
   * Resolved local-AS DCR config. Only `local` mode carries `dcr`; every other
   * mode returns `undefined`, preserving the historical behavior exactly.
   */
  getDcrConfig(): DcrRegistryConfig | undefined {
    if (isLocalMode(this.options)) {
      return this.options.dcr;
    }
    return undefined;
  }

  /**
   * Whether `POST /oauth/register` and the `registration_endpoint` advertisement
   * are active. Honors an explicit `dcr.enabled`; when unset, falls back to the
   * historical guard (enabled in development, disabled in production).
   */
  isDcrEnabled(): boolean {
    const dcr = this.getDcrConfig();
    if (dcr && typeof dcr.enabled === 'boolean') {
      return dcr.enabled;
    }
    return !isProduction();
  }

  /** Provider configurations (indexed by provider ID) */
  private readonly providerConfigs = new Map<string, UpstreamProviderConfig>();
  /** Provider token renewals in flight, by provider and refresh token (see {@link providerTokenRefresher}). */
  private readonly providerRenewals = new Map<string, ReturnType<TokenRefreshCallback>>();

  /**
   * Remote-mode single upstream provider id (set by {@link registerRemoteProvider}).
   *
   * In `mode: 'remote'` FrontMCP federates exactly ONE mandatory upstream IdP.
   * The authorize flow auto-starts federation against this id (no in-tree login
   * page, no provider-selection page), and tools read its token via
   * `this.orchestration.getToken(remoteProviderId)`. Undefined in every other mode.
   */
  private remoteProviderIdImpl?: string;

  /** Remote-mode single upstream provider id, or undefined outside remote mode. */
  get remoteProviderId(): string | undefined {
    return this.remoteProviderIdImpl;
  }

  /** Default access token TTL (1 hour) */
  private readonly accessTokenTtlSeconds = 3600;
  /** Default refresh token TTL (30 days) */
  private readonly refreshTokenTtlSeconds = 30 * 24 * 3600;

  constructor(
    private scope: ScopeEntry,
    private providers: ProviderRegistry,
    options: LocalPrimaryAuthOptions,
  ) {
    super(options);
    this.logger = this.providers.getActiveScope().logger.child('LocalPrimaryAuth');
    this.port = this.providers.getActiveScope().metadata.http?.port ?? defaultHttpPort();
    // Boot-time host fallback for the issuer. Previously hard-coded to
    // 'localhost', which produced wrong issuer/discovery URLs behind a proxy
    // or tunnel (#467). An explicit `local.issuer` (preferred) or the
    // FRONTMCP_PUBLIC_HOST env var override this; otherwise fall back to
    // 'localhost'. Request-derived discovery (well-known flows) is the runtime
    // source of truth — this only affects boot-time defaults.
    this.host = getEnv('FRONTMCP_PUBLIC_HOST')?.trim() || 'localhost';
    this.issuer = this.deriveIssuer(options);
    this.publicHostPinned = !!getEnv('FRONTMCP_PUBLIC_HOST')?.trim();

    // A whitespace-only value is not a secret; treat it as absent so it takes
    // the branches below rather than silently becoming the signing key. The key
    // itself is the RAW value — trimming it would change the key material and
    // invalidate every outstanding token for anyone whose secret has padding.
    const jwtSecret = getEnv('JWT_SECRET');
    const hasJwtSecret = !!jwtSecret?.trim();
    if (hasJwtSecret && jwtSecret) {
      const encoded = new TextEncoder().encode(jwtSecret);
      // RFC 7518 §3.2: HS256 MUST use a key at least as long as the hash output.
      // A shorter one is guessable, and a guessed signing key means forged tokens.
      if (encoded.length < MIN_HS256_SECRET_BYTES) {
        if (isProduction()) throw new JwtSecretWeakError(encoded.length);
        this.logger.warn(
          `JWT_SECRET is ${encoded.length} bytes; HS256 wants at least ${MIN_HS256_SECRET_BYTES} ` +
            '(RFC 7518). This is refused in production — generate one with `openssl rand -hex 32`.',
        );
      }
      this.secret = encoded;
    } else if (isProduction() && isOrchestratedMode(options)) {
      // Issue #546 — local/remote modes run the token endpoint, so they mint
      // tokens on every authorization. The fallback below is a random secret
      // generated once per process, which means outstanding tokens die on every
      // restart and a second instance (or a second Worker isolate) rejects
      // tokens the first one signed. That is a configuration fault, not a
      // degraded mode, so refuse rather than warn. Public mode never mints
      // through this path, so it neither throws nor warns.
      throw new JwtSecretRequiredError(options.mode);
    } else {
      // A public server has no user tokens to lose on restart, so the warning is noise there;
      // modes that mint and verify real tokens keep it.
      if (!isPublicMode(options)) {
        this.logger.warn(
          'JWT_SECRET is not set; signing with a random per-process secret. Tokens will not survive a ' +
            'restart and will not verify across instances. Set JWT_SECRET for any deployment that mints tokens.',
        );
      }
      this.secret = getDefaultNoAuthSecret();
    }

    // Read the token-storage selection. Only local/remote/orchestrated modes
    // carry `tokenStorage`; public mode does not (treated as 'memory').
    this.tokenStorage = this.readTokenStorage(options);

    // Default (memory) path: construct in-memory stores synchronously so the
    // out-of-the-box behavior is byte-for-byte identical to before. Persistent
    // backends (redis/sqlite) are swapped in by `initializeStores()` during the
    // async `initialize()` step below.
    this.authorizationStoreImpl = new InMemoryAuthorizationStore();
    this.federatedSessionStoreImpl = new InMemoryFederatedAuthSessionStore();
    this.orchestratedTokenStoreImpl = new InMemoryOrchestratedTokenStore({
      encryptionKey: this.secret, // Reuse JWT secret for token encryption
      refreshSkewMs: this.providerRefreshSkewMs(),
    });
    this.consentStoreImpl = new InMemoryConsentStore();

    // Local-AS DCR registry (#462). Seed any declarative `dcr.clients` so the
    // authorize/token flows accept those trusted clients without a DCR
    // round-trip. `getDcrConfig()` returns undefined outside local mode, so the
    // registry is simply empty there (preserving the historical behavior).
    this.dcrClientRegistryImpl = new DcrClientRegistry(this.getDcrConfig() ?? {});

    // Initialize CIMD service if orchestrated mode
    if (isOrchestratedMode(options)) {
      const cimdConfig = options.cimd;
      this.cimdService = new CimdService(this.logger, cimdConfig);
    }

    this.ready = this.initialize();
  }

  /**
   * Derive issuer from options.
   *
   * `FRONTMCP_PUBLIC_HOST` overrides only the HOST portion of the boot-time
   * issuer (see `this.host` in the constructor); the scheme stays `http` and
   * the port stays `this.port`. To override the scheme and/or port (e.g.
   * advertise `https://…` with no explicit port behind a TLS proxy), set an
   * explicit `local.issuer` — that is the supported way to make the boot-time
   * issuer match what discovery advertises. JWT verification accepts an issuer
   * array, so tokens minted under a different scheme/port are still tolerated
   * when running behind a TLS-terminating proxy, but `local.issuer` is the
   * supported knob for aligning the issuer with discovery.
   */
  private deriveIssuer(options: LocalPrimaryAuthOptions): string {
    return this.configuredIssuer(options) ?? `http://${this.host}:${this.port}${this.scope.fullPath}`;
  }

  /**
   * The issuer the options name: `issuer` in public mode, `local.issuer` in local and remote mode,
   * without a trailing slash, since the callback and metadata URLs are built by appending paths to it.
   */
  private configuredIssuer(options: LocalPrimaryAuthOptions): string | undefined {
    const configured = isPublicMode(options)
      ? options.issuer
      : isOrchestratedMode(options)
        ? options.local?.issuer
        : undefined;
    return configured === undefined ? undefined : normalizeIssuer(configured);
  }

  /**
   * The issuer this server names in answer to `request`: in its discovery
   * documents (`/.well-known/oauth-authorization-server`'s `issuer`, the
   * protected resource metadata's `authorization_servers`), on its
   * authorization responses (the RFC 9207 `iss`, errors included), and as the
   * `iss` of the tokens it issues; the tokens it accepts there must name it
   * (#269, and see {@link acceptedIssuersFor}). Every entry point asks this, so
   * none of them can disagree, on the Node server and under a Web fetch
   * handler alike (#629). In order:
   *
   * 1. a configured issuer (`issuer` / `local.issuer`);
   * 2. with `FRONTMCP_PUBLIC_URL` pinned, that URL plus this scope's path;
   * 3. with `FRONTMCP_PUBLIC_HOST` set, the boot-time issuer it names the host
   *    of (`http://<host>:<http.port><path>`);
   * 4. the request's own origin plus this scope's path;
   * 5. without a request, the boot-time issuer.
   */
  issuerFor(request?: ServerRequest): string {
    const configured = this.configuredIssuer(this.options);
    if (configured !== undefined) return configured;
    const pinned = getPinnedPublicUrl();
    if (pinned !== undefined) {
      return request
        ? computeIssuer(request, this.scope.entryPath, this.scope.routeBase)
        : `${pinned}${this.scope.fullPath}`;
    }
    if (this.publicHostPinned || !request) return this.issuer;
    return computeIssuer(request, this.scope.entryPath, this.scope.routeBase);
  }

  /**
   * The issuers a token presented with `request` may name: {@link issuerFor}
   * the request. When the issuer follows the request (nothing pins it) and
   * local or remote mode lists `expectedAudience`, a token for any listed
   * address was issued under that address's issuer, so each listed address's
   * issuer is accepted too, and so is the boot-time issuer that 1.8.4 named on
   * those tokens. The token's `aud` must still name a listed resource.
   */
  acceptedIssuersFor(request?: ServerRequest): string | string[] {
    const issuer = this.issuerFor(request);
    const options = this.options;
    const followsRequest =
      !!request &&
      this.configuredIssuer(options) === undefined &&
      getPinnedPublicUrl() === undefined &&
      !this.publicHostPinned;
    if (!followsRequest || !isOrchestratedMode(options) || options.expectedAudience === undefined) return issuer;
    const listed = Array.isArray(options.expectedAudience) ? options.expectedAudience : [options.expectedAudience];
    const accepted = new Set<string>([issuer, this.issuer]);
    for (const audience of listed) {
      const origin = originOf(audience);
      if (origin) accepted.add(`${origin}${this.scope.fullPath}`);
    }
    return [...accepted];
  }

  /**
   * Read the `tokenStorage` selection off the auth options. Only
   * local/remote/orchestrated modes declare it; public mode does not, in which
   * case we treat it as the in-memory default.
   */
  private readTokenStorage(options: LocalPrimaryAuthOptions): TokenStorageConfig | undefined {
    if ('tokenStorage' in options) {
      return (options as { tokenStorage?: TokenStorageConfig }).tokenStorage;
    }
    return undefined;
  }

  /**
   * When a persistent token-storage backend (Redis/SQLite) is configured, build
   * a shared `StorageAdapter` and swap the three in-memory stores for their
   * adapter-backed equivalents. For `'memory'` (or unset) this is a no-op, so
   * the default behavior is preserved exactly.
   *
   * The orchestrated-token store keeps using the JWT secret as its encryption
   * key, so upstream provider tokens stay encrypted at rest in every backend.
   */
  private async initializeStores(): Promise<void> {
    if (!isPersistentTokenStorage(this.tokenStorage)) {
      return; // memory default — keep the synchronously-constructed in-memory stores
    }

    try {
      const adapter = await createTokenStorageAdapter(this.tokenStorage);
      this.storageAdapter = adapter;

      this.authorizationStoreImpl = new StorageAuthorizationStore(adapter);
      this.federatedSessionStoreImpl = new StorageFederatedAuthSessionStore(adapter);
      this.orchestratedTokenStoreImpl = new StorageOrchestratedTokenStore(adapter, {
        encryptionKey: this.secret,
        refreshSkewMs: this.providerRefreshSkewMs(),
      });
      this.consentStoreImpl = new StorageConsentStore(adapter);

      const backend: 'sqlite' | 'redis' | 'unknown' = isSqliteTokenStorage(this.tokenStorage)
        ? 'sqlite'
        : isRedisTokenStorage(this.tokenStorage)
          ? 'redis'
          : 'unknown';
      this.logger.info(`Token storage initialized with persistent backend: ${backend}`);
    } catch (err) {
      // Persistence was explicitly requested; failing closed (rather than
      // silently using memory) avoids surprising token loss on restart.
      this.logger.error('Failed to initialize persistent token storage', err);
      throw err;
    }
  }

  /**
   * Build the per-session credential vault (Checkpoint 3b) and register the
   * `this.credentials` accessor + the `/oauth/connect` add-credential flow.
   *
   * Skipped in pure public mode (no authenticated subject / no authenticate()
   * verifier there). The vault shares the persistent StorageAdapter when one is
   * configured; otherwise it uses a dedicated in-memory adapter. The HMAC pepper
   * and resume-link signing key both derive from the server JWT secret
   * (`this.secret`), so resume URLs are framework-signed with the same trust
   * root as the access tokens.
   */
  /**
   * The server HMAC signing key, as the string form the `signData`/`verifyData`
   * helpers take. These are the exact bytes the access tokens are signed with,
   * so framework-signed URLs share the access tokens' trust root.
   */
  get signingSecret(): string {
    return new TextDecoder().decode(this.secret);
  }

  /**
   * Claim an incremental-authorization ticket, exactly once.
   *
   * A signature check proves a ticket was minted by this server for a verified
   * subject; it cannot prove the ticket has not already been used. The `auth_url`
   * carrying the ticket travels through agent transcripts and server logs, so a
   * leaked ticket must not stay usable for the rest of its TTL.
   *
   * The claim is race-free without a transaction: each attempt writes its OWN
   * nonce under `ifNotExists` and reads the key back. Only the attempt whose
   * nonce survives won, so concurrent replays all lose.
   *
   * @returns true when this caller claimed the ticket, false when it was already used.
   */
  async claimIncrementalTicket(jti: string, ttlMs: number): Promise<boolean> {
    const key = `incremental-ticket:${jti}`;
    const nonce = randomUUID();
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));

    let storage = await this.getTicketReplayStorage();
    try {
      await storage.set(key, nonce, { ifNotExists: true, ttlSeconds });
    } catch (error) {
      // A backend without compare-and-set (Cloudflare KV raises
      // StorageNotSupportedError) cannot host this guard at all. Rejecting
      // every ticket would disable incremental authorization silently, so fall
      // back to the in-memory guard once and keep single use within this
      // instance. Any other error is transient and fails CLOSED.
      if (!isUnsupportedOperation(error)) {
        this.logger.warn(`Incremental ticket replay guard unavailable: ${String(error)}`);
        return false;
      }
      this.logger.warn(
        'Incremental ticket replay guard: the configured storage has no conditional write; ' +
          'falling back to an in-memory guard (single use holds within this instance only).',
      );
      storage = await this.useInMemoryTicketReplayStorage();
      try {
        await storage.set(key, nonce, { ifNotExists: true, ttlSeconds });
      } catch (fallbackError) {
        this.logger.warn(`Incremental ticket replay guard unavailable: ${String(fallbackError)}`);
        return false;
      }
    }

    try {
      return (await storage.get(key)) === nonce;
    } catch (error) {
      this.logger.warn(`Incremental ticket replay guard unavailable: ${String(error)}`);
      return false;
    }
  }

  private getTicketReplayStorage(): Promise<StorageAdapter> {
    if (!this.ticketReplayStorage) {
      if (this.storageAdapter) {
        this.ticketReplayStorage = Promise.resolve(this.storageAdapter);
      } else {
        // No persistent token storage configured. The guard is then per-process
        // — but so are the pending authorizations and codes this flow depends
        // on, so such a deployment is single-instance by construction.
        this.logger.debug(
          'Incremental ticket replay guard is in-memory (no persistent tokenStorage configured); ' +
            'single use holds within this instance only.',
        );
        this.ticketReplayStorage = this.useInMemoryTicketReplayStorage();
      }
    }
    return this.ticketReplayStorage;
  }

  /** Replace the replay guard with a fresh in-memory adapter, memoized. */
  private useInMemoryTicketReplayStorage(): Promise<StorageAdapter> {
    const pending = (async () => {
      const memory = new MemoryStorageAdapter();
      await memory.connect();
      return memory;
    })();
    this.ticketReplayStorage = pending;
    return pending;
  }

  private async initializeCredentialVault(): Promise<void> {
    // Public mode has no authenticate() verifier and no stable sub — no vault.
    if (isPublicMode(this.options)) {
      return;
    }

    let storage: StorageAdapter;
    if (this.storageAdapter) {
      // Reuse the persistent adapter (Redis/SQLite) backing the token stores.
      storage = this.storageAdapter;
    } else {
      // Memory default — a dedicated in-memory adapter for the vault.
      const memory = new MemoryStorageAdapter();
      await memory.connect();
      storage = memory;
    }

    // Pepper: VAULT_SECRET ?? JWT_SECRET, else the in-memory default secret.
    // SessionCredentialVault warns when no env secret is set (random fallback);
    // we pass the decoded server secret so behavior matches the token signer.
    const pepper = getEnv('VAULT_SECRET') ?? getEnv('JWT_SECRET') ?? undefined;

    this.credentialVaultImpl = new SessionCredentialVault({
      storage,
      pepper,
      logger: this.logger.child('SessionCredentialVault'),
    });

    // The resume-link HMAC key is the server JWT secret (constant-time verified
    // by the connect flow). Reuse the exact bytes the access tokens are signed
    // with so the trust root is identical.
    const signingSecret = this.signingSecret;
    const basePath = this.issuer;

    await this.providers.addDynamicProviders(
      createCredentialsProviders({
        vault: this.credentialVaultImpl,
        signingSecret,
        basePath,
      }),
    );

    // Install `this.credentials` on ExecutionContextBase (idempotent).
    installContextExtensions('credentials', [credentialsContextExtension]);

    this.logger.debug('SessionCredentialVault initialized; this.credentials enabled');
  }

  /**
   * Read the `secureStore` selection off the auth options. Only
   * local/remote/orchestrated modes declare it; public mode does not.
   */
  private readSecureStoreConfig(): SecureStoreConfig | undefined {
    if ('secureStore' in this.options) {
      return (this.options as { secureStore?: SecureStoreConfig }).secureStore;
    }
    return undefined;
  }

  /**
   * Build the general session-scoped secure-secret store (#470) and register the
   * `this.secureStore` accessor.
   *
   * Skipped in pure public mode (no authenticated subject / no session-bound
   * secrets there). The backing comes from `auth.secureStore`:
   * - unset / `'memory'` → in-memory, AES-256-GCM-encrypted store (default);
   * - `{ sqlite }` / `{ redis }` → persistent encrypted store. When the chosen
   *   persistent backing matches the configured `tokenStorage`, the SAME
   *   StorageAdapter is reused (one connection);
   * - `{ backend }` → a custom backing used as-is (e.g. an OS keychain) — the
   *   framework bundles NO native dependency for this path.
   *
   * The HKDF pepper for the built-in encrypted backings derives from the server
   * JWT secret (`this.secret`) unless an explicit `encryption.pepper` is set, so
   * secrets share the same trust root as the access tokens.
   */
  private async initializeSecureStore(): Promise<void> {
    // Public mode has no stable sub / session-bound secret scope — no store.
    if (isPublicMode(this.options)) {
      return;
    }

    const config = this.readSecureStoreConfig();

    // Reuse the persistent token-storage adapter ONLY when the secure store is
    // configured for the same persistent backing as tokenStorage. Otherwise let
    // the factory build a dedicated (in-memory or independently-configured) one.
    const reuseAdapter =
      this.storageAdapter && this.secureStoreSharesTokenStorage(config) ? this.storageAdapter : undefined;

    // Built-in encrypted backings derive their pepper from the server JWT secret
    // (matching the token signer / credential vault) unless overridden in config.
    const pepper = getEnv('VAULT_SECRET') ?? getEnv('JWT_SECRET') ?? new TextDecoder().decode(this.secret);

    const resolved = await createSecureStore({
      config,
      pepper,
      storage: reuseAdapter,
      logger: this.logger.child('SecureStore'),
    });
    this.secureStoreBackendImpl = resolved.backend;

    await this.providers.addDynamicProviders(
      createSecureStoreProviders({
        backend: resolved.backend,
        scope: resolved.scope,
        ttlMs: resolved.ttlMs,
      }),
    );

    // Install `this.secureStore` on ExecutionContextBase (idempotent).
    installContextExtensions('secureStore', [secureStoreContextExtension]);

    this.logger.debug(
      `SecureStore initialized (backing: ${resolved.kind}, scope: ${resolved.scope}); this.secureStore enabled`,
    );
  }

  /**
   * Whether the `secureStore` config selects the SAME persistent backing as the
   * configured `tokenStorage`, so they can share one StorageAdapter. Returns
   * false for memory/custom/undefined and for mismatched backings (in which case
   * the secure store gets its own adapter).
   */
  private secureStoreSharesTokenStorage(config: SecureStoreConfig | undefined): boolean {
    if (typeof config !== 'object' || config === null) return false;
    if ('sqlite' in config && config.sqlite) return isSqliteTokenStorage(this.tokenStorage);
    if ('redis' in config && config.redis) return isRedisTokenStorage(this.tokenStorage);
    return false;
  }

  /**
   * Sign a token for the anonymous grant (`grant_type=anonymous`).
   *
   * The holder is anonymous (#270): the subject is an `anon:` id, so
   * `this.auth.isAnonymous` is true and authorities treat it as no signed-in
   * user, and its scopes are the configured `anonymousScopes`, never a role.
   *
   * @param options.audience The protected resource the token is for (`aud`, #269).
   * @param options.issuer   The issuer to name (`iss`): {@link issuerFor} the request. Default: the boot-time issuer.
   */
  async signAnonymousJwt(options: { audience?: string; issuer?: string } = {}) {
    const jwt = new SignJWT({ sub: `anon:${randomUUID()}`, anonymous: true, scope: this.anonymousScopes().join(' ') })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setIssuer(options.issuer ?? this.issuer)
      .setExpirationTime(`${this.anonymousTokenTtlSeconds()}s`)
      .setJti(randomUUID());
    if (options.audience) jwt.setAudience(options.audience);
    return jwt.sign(this.secret);
  }

  /** How long an anonymous token lives: public mode's `sessionTtl` (default an hour), a day otherwise. */
  anonymousTokenTtlSeconds(): number {
    return isPublicMode(this.options) ? (this.options.sessionTtl ?? 3600) : 86400;
  }

  /** The scopes an anonymous caller holds: `anonymousScopes`, default `['anonymous']`. */
  private anonymousScopes(): string[] {
    const scopes = (this.options as { anonymousScopes?: unknown }).anonymousScopes;
    return Array.isArray(scopes) ? scopes.filter((s): s is string => typeof s === 'string') : ['anonymous'];
  }

  /**
   * Cryptographically verify a gateway-issued access token (public/local/remote
   * "gateway" modes). Gateway tokens — both authenticated access tokens
   * ({@link signAccessToken}) and anonymous tokens ({@link signAnonymousJwt}) —
   * are HS256-signed with `this.secret`.
   *
   * The secret alone doesn't make a token this server's: every server started
   * with the same JWT_SECRET holds it. So a token must also (#269):
   * - name THIS instance as its issuer (`iss`): `expectedIssuer` (one issuer or
   *   several), which callers take from {@link acceptedIssuersFor} the request,
   *   matching what the token endpoint names when it signs ({@link issuerFor});
   *   the boot-time issuer when not given. Never the token's own claim; and
   * - when `expectedAudience` is given, be issued for that protected resource,
   *   or one of those resources (`aud`, compared as RFC 8707 resource URIs).
   *   `session:verify` passes the request's resource URL, or the configured
   *   `auth.expectedAudience` when there is one.
   *
   * Lifetime: `exp` is required (#272) and checked with `nbf` by `jose`. The
   * algorithm is pinned to HS256 to block `alg` confusion.
   */
  override async verifyGatewayToken(
    token: string,
    requestBaseUrl: string,
    expectedAudience?: string | readonly string[],
    expectedIssuer?: string | readonly string[],
  ): Promise<VerifyResult> {
    try {
      const { payload, protectedHeader } = await jwtVerify(token, this.secret, {
        algorithms: ['HS256'],
        issuer:
          typeof expectedIssuer === 'string' ? expectedIssuer : expectedIssuer ? [...expectedIssuer] : this.issuer,
        requiredClaims: ['exp'],
      });
      if (expectedAudience !== undefined && !audienceMatchesResource(payload.aud, expectedAudience)) {
        return { ok: false, error: 'Token audience does not match this resource' };
      }
      return {
        ok: true,
        issuer: (payload.iss as string | undefined) ?? requestBaseUrl,
        sub: payload.sub,
        header: protectedHeader,
        payload,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'verification_failed';
      return { ok: false, error: message };
    }
  }

  /**
   * Sign an access token for an authenticated user
   */
  async signAccessToken(
    user: UserInfo,
    scopes: string[],
    audience?: string,
    consentMetadata?: ConsentMetadata,
    /** The issuer to name (`iss`): {@link issuerFor} the request. Default: the boot-time issuer. */
    issuer?: string,
  ): Promise<string> {
    const claims: Record<string, unknown> = {
      sub: user.sub,
      scope: scopes.join(' '),
    };

    if (user.email) claims['email'] = user.email;
    if (user.name) claims['name'] = user.name;
    if (user.picture) claims['picture'] = user.picture;
    if (user.roles) claims['roles'] = user.roles;

    // Add consent metadata if present
    if (consentMetadata) {
      if (consentMetadata.consentEnabled) {
        claims['consent'] = {
          enabled: true,
          selectedTools: consentMetadata.selectedToolIds ?? [],
        };
      }
      if (consentMetadata.federatedLoginUsed) {
        claims['federated'] = {
          enabled: true,
          selectedProviders: consentMetadata.selectedProviderIds ?? [],
          skippedProviders: consentMetadata.skippedProviderIds ?? [],
        };
      }

      // Progressive/Incremental authorization — embed the granted app-id set as
      // the `authorized_apps` claim. Only present when the caller supplied it
      // (i.e. `incrementalAuth` is enabled for the scope), which is what turns
      // on app-level gating in `checkToolAuthorization`. Omitting it for
      // non-incremental setups preserves the historical allow-all behavior.
      if (consentMetadata.authorizedAppIds) {
        claims['authorized_apps'] = consentMetadata.authorizedAppIds;
      }

      // Checkpoint 3a — merge custom claims from a local authenticate() verifier.
      // Reserved claims (sub/iss/exp/scope/…) are dropped so a verifier can never
      // forge identity/lifetime/scope claims; everything else is merged in.
      if (consentMetadata.customClaims) {
        for (const [key, value] of Object.entries(consentMetadata.customClaims)) {
          if (RESERVED_JWT_CLAIMS.has(key)) {
            this.logger.warn(`Dropping reserved claim "${key}" from authenticate() custom claims`);
            continue;
          }
          claims[key] = value;
        }
      }
    }

    const jwt = new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setIssuer(issuer ?? this.issuer)
      .setExpirationTime(`${this.accessTokenTtlSeconds}s`)
      .setJti(randomUUID());

    if (audience) {
      jwt.setAudience(audience);
    }

    return jwt.sign(this.secret);
  }

  /**
   * Exchange an authorization code for tokens
   */
  async exchangeCode(
    code: string,
    clientId: string,
    redirectUri: string,
    codeVerifier: string,
    clientSecret?: string,
    /** The protected resource the token is for when the grant recorded none (#269). */
    defaultAudience?: string,
    /** The issuer the access token names: {@link issuerFor} the token request. */
    issuer?: string,
  ): Promise<TokenResponse | { error: string; error_description: string }> {
    // Authenticate confidential clients (RFC 6749 §2.3 / §3.2.1). Public and
    // unregistered / CIMD clients ('none' / 'unknown') carry no secret and are
    // unaffected; a registered confidential client MUST present a matching
    // secret (timing-safe) — previously the secret was never checked.
    if (this.dcrClientRegistryImpl.verifyClientSecret(clientId, clientSecret) === 'invalid') {
      this.logger.warn('Client authentication failed at token endpoint (authorization_code)');
      return { error: 'invalid_client', error_description: 'Client authentication failed' };
    }

    // Get the authorization code record
    const codeRecord = await this.authorizationStore.getAuthorizationCode(code);

    if (!codeRecord) {
      this.logger.warn(`Authorization code not found or expired: ${code.substring(0, 8)}...`);
      return {
        error: 'invalid_grant',
        error_description: 'Authorization code is invalid or expired',
      };
    }

    // Verify code hasn't been used (single-use)
    if (codeRecord.used) {
      this.logger.warn(`Authorization code already used: ${code.substring(0, 8)}...`);
      // OAuth 2.1 §4.1.2 breach handling: re-presenting an already-used code is
      // a strong signal it leaked, so revoke the refresh token minted from it
      // (previously the code record was merely deleted, leaving the issued
      // tokens live).
      if (codeRecord.issuedRefreshToken) {
        try {
          await this.authorizationStore.revokeRefreshToken(codeRecord.issuedRefreshToken);
        } catch (err) {
          this.logger.warn(`Failed to revoke refresh token on authorization-code replay: ${err}`);
        }
      }
      await this.authorizationStore.deleteAuthorizationCode(code);
      return {
        error: 'invalid_grant',
        error_description: 'Authorization code has already been used',
      };
    }

    // Verify client_id matches
    if (codeRecord.clientId !== clientId) {
      this.logger.warn(`Client ID mismatch: expected ${codeRecord.clientId}, got ${clientId}`);
      return {
        error: 'invalid_grant',
        error_description: 'Client ID does not match',
      };
    }

    // Verify redirect_uri matches
    if (codeRecord.redirectUri !== redirectUri) {
      this.logger.warn(`Redirect URI mismatch`);
      return {
        error: 'invalid_grant',
        error_description: 'Redirect URI does not match',
      };
    }

    // Verify PKCE
    if (!verifyPkce(codeVerifier, codeRecord.pkce)) {
      this.logger.warn(`PKCE verification failed`);
      return {
        error: 'invalid_grant',
        error_description: 'PKCE verification failed',
      };
    }

    // Mark code as used
    await this.authorizationStore.markCodeUsed(code);

    // Generate tokens
    const user: UserInfo = {
      sub: codeRecord.userSub,
      email: codeRecord.userEmail,
      name: codeRecord.userName,
    };

    // Build consent metadata from code record. Includes custom claims from a
    // local authenticate() verifier (Checkpoint 3a) so they are embedded in the
    // minted access token even when consent/federation are not in play. Also
    // carries the progressive-auth `authorizedAppIds` so the minted token's
    // `authorized_apps` claim reflects the granted app set.
    const hasCustomClaims = !!codeRecord.customClaims && Object.keys(codeRecord.customClaims).length > 0;
    const hasAuthorizedApps = Array.isArray(codeRecord.authorizedAppIds);
    const consentMetadata: ConsentMetadata | undefined =
      codeRecord.consentEnabled || codeRecord.federatedLoginUsed || hasCustomClaims || hasAuthorizedApps
        ? {
            selectedToolIds: codeRecord.selectedToolIds,
            selectedProviderIds: codeRecord.selectedProviderIds,
            skippedProviderIds: codeRecord.skippedProviderIds,
            consentEnabled: codeRecord.consentEnabled,
            federatedLoginUsed: codeRecord.federatedLoginUsed,
            authorizedAppIds: codeRecord.authorizedAppIds,
            customClaims: codeRecord.customClaims,
          }
        : undefined;

    // Every token names the resource it is for (#269); the authorize flow
    // records one, `defaultAudience` covers a grant that predates that.
    const resource = codeRecord.resource ?? defaultAudience;
    const accessToken = await this.signAccessToken(user, codeRecord.scopes, resource, consentMetadata, issuer);

    // Migrate tokens from pending to real authorization ID (for federated auth)
    let providerTokensId: string | undefined;
    if (codeRecord.pendingAuthId && codeRecord.federatedLoginUsed) {
      providerTokensId = await this.moveProviderTokens(`pending:${codeRecord.pendingAuthId}`, accessToken);
    }

    // Create refresh token — carry the grant's consent / progressive-auth /
    // custom-claim metadata so a later refresh re-mints an access token with
    // the SAME claims (otherwise refresh silently drops `consent` /
    // `authorized_apps` and the claim-driven tool gate fails open).
    const refreshTokenRecord = this.authorizationStore.createRefreshTokenRecord({
      clientId,
      userSub: user.sub,
      scopes: codeRecord.scopes,
      resource,
      userEmail: user.email,
      userName: user.name,
      consentEnabled: codeRecord.consentEnabled,
      selectedToolIds: codeRecord.selectedToolIds,
      authorizedAppIds: codeRecord.authorizedAppIds,
      customClaims: codeRecord.customClaims,
      federatedLoginUsed: codeRecord.federatedLoginUsed,
      selectedProviderIds: codeRecord.selectedProviderIds,
      skippedProviderIds: codeRecord.skippedProviderIds,
      providerTokensId,
    });
    await this.authorizationStore.storeRefreshToken(refreshTokenRecord);
    // Bind the issued refresh token to the (already used-marked) code so a later
    // replay of this code can revoke the token family it minted.
    await this.authorizationStore.markCodeUsed(code, refreshTokenRecord.token);

    this.logger.info(`Tokens issued for user: ${user.sub}`);

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: this.accessTokenTtlSeconds,
      refresh_token: refreshTokenRecord.token,
      scope: codeRecord.scopes.join(' '),
    };
  }

  /**
   * Move the upstream provider tokens stored under `fromAuthorizationId` to the authorization id of
   * `accessToken`, where `this.orchestration` looks for them. Returns where they are now: that id, or
   * `fromAuthorizationId` when the move failed, so the next refresh tries again (the token is still
   * issued; its tools find no provider token until then).
   */
  private async moveProviderTokens(fromAuthorizationId: string, accessToken: string): Promise<string> {
    const toAuthorizationId = deriveAuthorizationId(accessToken);
    try {
      await this.orchestratedTokenStore.migrateTokens(fromAuthorizationId, toAuthorizationId);
      this.logger.info(`Migrated tokens from ${fromAuthorizationId} to ${toAuthorizationId}`);
      return toAuthorizationId;
    } catch (err) {
      this.logger.warn(`Failed to migrate tokens: ${err}`);
      return fromAuthorizationId;
    }
  }

  /**
   * Copy the upstream provider tokens stored under `fromAuthorizationId` to the authorization id of
   * `accessToken`. Returns that id, or undefined when the store cannot copy (the refresh then moves them)
   * or the copy failed (the token is issued without them, and the next refresh copies them again).
   */
  private async copyProviderTokens(fromAuthorizationId: string, accessToken: string): Promise<string | undefined> {
    const store = this.orchestratedTokenStore;
    if (!store.copyTokens) return undefined;
    const toAuthorizationId = deriveAuthorizationId(accessToken);
    try {
      await store.copyTokens(fromAuthorizationId, toAuthorizationId);
      return toAuthorizationId;
    } catch (err) {
      this.logger.warn(`Failed to copy provider tokens: ${err}`);
      await this.discardProviderTokens(toAuthorizationId);
      return undefined;
    }
  }

  /** Remove the upstream provider tokens stored under `authorizationId`; a failure leaves them to expire. */
  private async discardProviderTokens(authorizationId: string): Promise<void> {
    const store = this.orchestratedTokenStore;
    try {
      const providerIds = await store.getProviderIds(authorizationId);
      await Promise.all(providerIds.map((providerId) => store.deleteTokens(authorizationId, providerId)));
    } catch (err) {
      this.logger.warn(`Failed to discard provider tokens: ${err}`);
    }
  }

  /**
   * Refresh an access token using a refresh token
   */
  async refreshAccessToken(
    refreshToken: string,
    clientId: string,
    clientSecret?: string,
    /** The protected resource the token is for when the grant recorded none (#269). */
    defaultAudience?: string,
    /** The issuer the access token names: {@link issuerFor} the token request. */
    issuer?: string,
  ): Promise<TokenResponse | { error: string; error_description: string }> {
    // Authenticate confidential clients on refresh too (RFC 6749 §6): a stolen
    // refresh token must not be redeemable with just the public client_id.
    if (this.dcrClientRegistryImpl.verifyClientSecret(clientId, clientSecret) === 'invalid') {
      this.logger.warn('Client authentication failed at token endpoint (refresh_token)');
      return { error: 'invalid_client', error_description: 'Client authentication failed' };
    }

    const tokenRecord = await this.authorizationStore.getRefreshToken(refreshToken);

    if (!tokenRecord) {
      this.logger.warn('Refresh token not found or expired');
      return {
        error: 'invalid_grant',
        error_description: 'Refresh token is invalid or expired',
      };
    }

    if (tokenRecord.clientId !== clientId) {
      this.logger.warn('Client ID mismatch on refresh');
      return {
        error: 'invalid_grant',
        error_description: 'Client ID does not match',
      };
    }

    // Generate new access token — rebuild the identity + consent/progressive-
    // auth metadata from the stored refresh record so the refreshed token keeps
    // its `consent` / `authorized_apps` / custom claims. Without this the tool
    // gate (which authorizes purely from token claims and fails OPEN on a
    // missing claim) would grant every tool/app after a single refresh.
    const user: UserInfo = {
      sub: tokenRecord.userSub,
      email: tokenRecord.userEmail,
      name: tokenRecord.userName,
    };
    const hasAuthorizedApps = Array.isArray(tokenRecord.authorizedAppIds);
    const hasCustomClaims = !!tokenRecord.customClaims && Object.keys(tokenRecord.customClaims).length > 0;
    const consentMetadata: ConsentMetadata | undefined =
      tokenRecord.consentEnabled || tokenRecord.federatedLoginUsed || hasCustomClaims || hasAuthorizedApps
        ? {
            selectedToolIds: tokenRecord.selectedToolIds,
            selectedProviderIds: tokenRecord.selectedProviderIds,
            skippedProviderIds: tokenRecord.skippedProviderIds,
            consentEnabled: tokenRecord.consentEnabled,
            federatedLoginUsed: tokenRecord.federatedLoginUsed,
            authorizedAppIds: tokenRecord.authorizedAppIds,
            customClaims: tokenRecord.customClaims,
          }
        : undefined;
    // A refresh token issued before tokens named their resource gets one now (#269).
    const resource = tokenRecord.resource ?? defaultAudience;
    const accessToken = await this.signAccessToken(user, tokenRecord.scopes, resource, consentMetadata, issuer);
    // Provider tokens are copied to the new access token, and leave the old one only once the rotation succeeded.
    const sourceId = tokenRecord.providerTokensId;
    const copiedTo = sourceId ? await this.copyProviderTokens(sourceId, accessToken) : undefined;
    // A concurrent redemption may have rotated this refresh token, and removed the copied source, since it was read.
    if (sourceId && !(await this.authorizationStore.getRefreshToken(refreshToken))) {
      if (copiedTo) await this.discardProviderTokens(copiedTo);
      this.logger.warn('Refresh token was redeemed by a concurrent request');
      return { error: 'invalid_grant', error_description: 'Refresh token is invalid or expired' };
    }

    // Rotate refresh token — forward the same grant metadata to the new record.
    const newRefreshRecord = this.authorizationStore.createRefreshTokenRecord({
      clientId,
      userSub: tokenRecord.userSub,
      scopes: tokenRecord.scopes,
      resource,
      userEmail: tokenRecord.userEmail,
      userName: tokenRecord.userName,
      consentEnabled: tokenRecord.consentEnabled,
      selectedToolIds: tokenRecord.selectedToolIds,
      authorizedAppIds: tokenRecord.authorizedAppIds,
      customClaims: tokenRecord.customClaims,
      federatedLoginUsed: tokenRecord.federatedLoginUsed,
      selectedProviderIds: tokenRecord.selectedProviderIds,
      skippedProviderIds: tokenRecord.skippedProviderIds,
      providerTokensId: copiedTo ?? sourceId,
    });
    try {
      await this.authorizationStore.rotateRefreshToken(refreshToken, newRefreshRecord);
    } catch (err) {
      if (copiedTo) await this.discardProviderTokens(copiedTo);
      throw err;
    }
    if (sourceId && copiedTo) await this.discardProviderTokens(sourceId);
    // A store that cannot copy moves them now; the rotated record names their new place once the move succeeded.
    if (sourceId && !this.orchestratedTokenStore.copyTokens) {
      const movedTo = await this.moveProviderTokens(sourceId, accessToken);
      if (movedTo !== sourceId) {
        await this.authorizationStore.storeRefreshToken({ ...newRefreshRecord, providerTokensId: movedTo });
      }
    }

    this.logger.info(`Tokens refreshed for user: ${user.sub}`);

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: this.accessTokenTtlSeconds,
      refresh_token: newRefreshRecord.token,
      scope: tokenRecord.scopes.join(' '),
    };
  }

  /**
   * Create an authorization code for a user (called after login)
   */
  async createAuthorizationCode(params: {
    clientId: string;
    redirectUri: string;
    scopes: string[];
    codeChallenge: string;
    userSub: string;
    userEmail?: string;
    userName?: string;
    state?: string;
    resource?: string;
    // Consent and Federated Login Data
    selectedToolIds?: string[];
    selectedProviderIds?: string[];
    skippedProviderIds?: string[];
    consentEnabled?: boolean;
    federatedLoginUsed?: boolean;
    // Token migration ID (for federated auth)
    pendingAuthId?: string;
    // Progressive/Incremental authorization: granted app-id set (embedded as the
    // `authorized_apps` claim). Only set when incrementalAuth is enabled.
    authorizedAppIds?: string[];
    // Custom claims from a local authenticate() verifier (Checkpoint 3a)
    customClaims?: Record<string, unknown>;
  }): Promise<string> {
    const codeRecord = this.authorizationStore.createCodeRecord({
      clientId: params.clientId,
      redirectUri: params.redirectUri,
      scopes: params.scopes,
      pkce: { challenge: params.codeChallenge, method: 'S256' },
      userSub: params.userSub,
      userEmail: params.userEmail,
      userName: params.userName,
      state: params.state,
      resource: params.resource,
      // Consent and Federated Login Data
      selectedToolIds: params.selectedToolIds,
      selectedProviderIds: params.selectedProviderIds,
      skippedProviderIds: params.skippedProviderIds,
      consentEnabled: params.consentEnabled,
      federatedLoginUsed: params.federatedLoginUsed,
      // Token migration ID (for federated auth)
      pendingAuthId: params.pendingAuthId,
      // Progressive/Incremental authorization: granted app-id set.
      authorizedAppIds: params.authorizedAppIds,
      // Custom claims from a local authenticate() verifier (Checkpoint 3a)
      customClaims: params.customClaims,
    });

    await this.authorizationStore.storeAuthorizationCode(codeRecord);
    this.logger.info(`Authorization code created for user: ${params.userSub}`);

    return codeRecord.code;
  }

  protected async initialize(): Promise<void> {
    // Swap in persistent (Redis/SQLite) stores when configured. Runs before the
    // server signals ready, so flows always see the final store instances.
    await this.initializeStores();

    // Bridge declarative `auth.providers` (local-mode multi-provider
    // orchestration) into the upstream-provider registry so the federated
    // /oauth/authorize + /oauth/provider/:id/callback flows can drive them.
    this.registerConfiguredProviders();

    // Remote mode (`mode: 'remote'`): register the flat remote config as the
    // single MANDATORY upstream provider so /oauth/authorize federates straight
    // to the upstream IdP (no in-tree login page) and the provider-callback flow
    // exchanges/stores its tokens + derives the session identity from upstream.
    this.registerRemoteProvider();

    // Build the per-session credential vault and register `this.credentials`
    // (Checkpoint 3b). Runs after initializeStores so it can share the same
    // persistent StorageAdapter when one is configured.
    await this.initializeCredentialVault();

    // Build the general session secure-secret store and register
    // `this.secureStore` (#470). Runs after initializeStores so it can share the
    // same persistent StorageAdapter when configured for the same backing.
    await this.initializeSecureStore();

    // TODO: create separated jwk service for local/remote auth options
    this.providers.injectProvider({
      value: this.jwks,
      metadata: {
        scope: ProviderScope.GLOBAL,
        name: 'auth:jwk-service',
      },
      provide: JwksService,
    });

    // Register CIMD service if initialized; its cache (Redis with `cimd.cache.type: 'redis'`) is created now
    if (this.cimdService) {
      const cimdService = this.cimdService;
      if (cimdService.enabled) await cimdService.initialize();
      this.scope.onDispose(() => cimdService.dispose());
      this.providers.injectProvider({
        value: cimdService,
        metadata: {
          scope: ProviderScope.GLOBAL,
          name: 'auth:cimd-service',
        },
        provide: CimdService,
      });
      this.logger.debug('CIMD service registered');
    }

    await this.registerAuthFlows();

    return Promise.resolve();
  }

  override fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return fetch(input, init);
  }

  override validate(request: ServerRequest): Promise<void> {
    return Promise.resolve();
  }

  private async registerAuthFlows() {
    const scope = this.providers.getActiveScope();
    await scope.registryFlows(
      WellKnownPrmFlow /** /.well-known/oauth-protected-resource */,
      WellKnownAsFlow /** /.well-known/oauth-authorization-server */,
      WellKnownJwksFlow /** /.well-known/jwks.json */,
      SessionVerifyFlow /** Session verification flow */,

      OauthAuthorizeFlow /** GET /oauth/authorize */,
      OauthTokenFlow /** POST /oauth/token */,
      OauthUserInfoFlow /** GET /oauth/userinfo - OIDC userinfo */,
      OauthCallbackFlow /** GET /oauth/callback - login callback */,
      OauthConnectFlow /** GET|POST /oauth/connect - mid-session add-credential (Checkpoint 3b) */,
      OauthRegisterFlow /** POST /oauth/register */,
      OauthProviderCallbackFlow /** GET /oauth/provider/:providerId/callback */,
      OauthAuthUiExtraFlow /** POST /oauth/ui/extra — @AuthExtra validated-field submit (#469) */,
    );
  }

  // ============================================
  // Upstream Provider OAuth Methods
  // ============================================

  /**
   * Register an upstream OAuth provider configuration
   */
  registerProvider(config: UpstreamProviderConfig): void {
    // Credentials are bound to the authorization server that issued them
    // (MCP 2026-07-28, SEP-2352). Re-registering a provider under a DIFFERENT
    // issuer means the counterparty changed, so anything cached for the old one
    // must be dropped rather than silently reused against the new AS.
    const previous = this.providerConfigs.get(config.id);
    // Compare normalized, exactly as `validateAuthorizationIssuer` does — a bare
    // trailing-slash difference names the SAME issuer and must not throw away
    // working credentials.
    const issuerChanged =
      previous?.issuer !== undefined &&
      config.issuer !== undefined &&
      normalizeIssuer(previous.issuer) !== normalizeIssuer(config.issuer);
    if (issuerChanged) {
      this.logger.warn(
        `Upstream provider "${config.id}" changed issuer (${previous.issuer} → ${config.issuer}); ` +
          `discarding credentials bound to the previous authorization server`,
      );
      void this.discardProviderCredentials(config.id);
    }

    this.providerConfigs.set(config.id, config);
    this.logger.info(`Registered upstream provider: ${config.id}`);
  }

  /**
   * Drop every stored credential for a provider whose authorization server changed.
   *
   * Best-effort: the token store may be memory-backed and already empty. Failing
   * here must not block re-registration, but the credentials MUST NOT survive,
   * so a failure is logged loudly rather than swallowed.
   */
  private async discardProviderCredentials(providerId: string): Promise<void> {
    try {
      const store = this.orchestratedTokenStoreImpl as {
        deleteTokensForProvider?: (providerId: string) => Promise<void>;
      };

      if (typeof store.deleteTokensForProvider !== 'function') {
        // The `TokenStore` interface has no provider-wide delete, and there is no
        // way to enumerate authorization ids to call `deleteTokens` per entry.
        // Say so loudly instead of reporting a purge that did not happen —
        // an operator changing an issuer needs to know to rotate manually.
        this.logger.warn(
          `Cannot auto-discard credentials for provider "${providerId}": the configured token store does not ` +
            `support provider-wide deletion. Rotate or clear the store manually so credentials issued by the ` +
            `previous authorization server are not reused.`,
        );
        return;
      }

      await store.deleteTokensForProvider(providerId);
    } catch (error) {
      this.logger.error(
        `Failed to discard credentials for provider "${providerId}" after an issuer change`,
        error instanceof Error ? { message: error.message } : { error },
      );
    }
  }

  /**
   * Bridge declarative `auth.providers` (local-mode multi-provider orchestration)
   * into the upstream-provider registry. Runs once during `initialize()`.
   *
   * For each declared provider we map the ergonomic `authorizeUrl`/`tokenUrl`
   * aliases onto the canonical `authorizationEndpoint`/`tokenEndpoint`, default
   * `name`/`scopes`, and compute the per-provider callback URL from the issuer
   * (`${issuer}/oauth/provider/${id}/callback`). No-op when not local mode or
   * when no providers are declared, so existing configs are unaffected.
   *
   * Security: only non-PII provider metadata is read here; client secrets are
   * kept in the provider config and never logged or exposed to the LLM.
   */
  private registerConfiguredProviders(): void {
    if (!isLocalMode(this.options)) {
      return;
    }
    const providers = this.options.providers;
    if (!providers || providers.length === 0) {
      return;
    }

    for (const p of providers) {
      const authorizationEndpoint = p.authorizationEndpoint ?? p.authorizeUrl;
      const tokenEndpoint = p.tokenEndpoint ?? p.tokenUrl;
      if (!authorizationEndpoint || !tokenEndpoint) {
        // Fail fast: a half-configured provider would silently drop out of the
        // registry, and `handleFederatedAuth` could then fall through to the
        // next provider as if this one were never declared. Rejecting in
        // initialize() (which surfaces via `ready`) forces the config to be
        // fixed before the server accepts traffic.
        const missing = !authorizationEndpoint
          ? !tokenEndpoint
            ? 'authorization and token endpoints'
            : 'authorization endpoint (authorizationEndpoint/authorizeUrl)'
          : 'token endpoint (tokenEndpoint/tokenUrl)';
        throw new Error(`Provider "${p.id}" is missing its ${missing}.`);
      }

      this.registerProvider({
        id: p.id,
        name: p.name ?? p.id,
        authorizationEndpoint,
        tokenEndpoint,
        userInfoEndpoint: p.userInfoEndpoint,
        jwksUri: p.jwksUri,
        clientId: p.clientId,
        clientSecret: p.clientSecret,
        scopes: p.scopes ?? [],
        callbackUrl: `${this.issuer}/oauth/provider/${p.id}/callback`,
        issuer: p.issuer,
        additionalIssuers: p.additionalIssuers,
      });
    }
  }

  /**
   * Remote mode (`mode: 'remote'`): register the flat remote config as the
   * SINGLE mandatory upstream provider. Runs once during `initialize()`.
   *
   * The flat fields (`provider` base URL + `clientId`/`clientSecret`/`scopes`)
   * and the `providerConfig` endpoint overrides (`authEndpoint`/`tokenEndpoint`/
   * `userInfoEndpoint`/`jwksUri`) are mapped onto an {@link UpstreamProviderConfig}.
   * Endpoints not explicitly overridden are derived from the `provider` base URL
   * using the standard OIDC paths (`/authorize`, `/token`, `/userinfo`,
   * `/.well-known/jwks.json`) — the same convention `transparent` mode uses for
   * discovery. The provider id comes from `providerConfig.id` when set, else it
   * is derived from the provider hostname (mirroring `deriveProviderId`).
   *
   * No-op outside remote mode, so local/public/transparent are unaffected.
   *
   * Security: only non-PII provider metadata is read here; the client secret is
   * kept in the provider config and never logged or exposed to the LLM.
   */
  private registerRemoteProvider(): void {
    if (!isRemoteMode(this.options)) {
      return;
    }

    const options = this.options;
    const base = options.provider.replace(/\/+$/, '');
    const cfg = options.providerConfig;

    const id = cfg?.id ?? this.deriveRemoteProviderId(options.provider);
    this.remoteProviderIdImpl = id;

    if (!options.clientId) {
      // The schema marks clientId optional (DCR placeholder), but without it we
      // cannot drive the upstream authorization-code flow. Skip registration so
      // the failure is a clear "provider not configured" rather than an upstream
      // 400 mid-redirect. DCR (deriving clientId at runtime) is not yet wired.
      this.logger.warn(
        `Remote mode: no clientId configured for provider "${id}"; upstream OAuth is not available (DCR is not yet wired)`,
      );
      return;
    }

    this.registerProvider({
      id,
      name: cfg?.name ?? id,
      authorizationEndpoint: cfg?.authEndpoint ?? `${base}/authorize`,
      tokenEndpoint: cfg?.tokenEndpoint ?? `${base}/token`,
      userInfoEndpoint: cfg?.userInfoEndpoint ?? `${base}/userinfo`,
      jwksUri: cfg?.jwksUri ?? `${base}/.well-known/jwks.json`,
      jwks: cfg?.jwks,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      scopes: options.scopes ?? ['openid'],
      callbackUrl: `${this.issuer}/oauth/provider/${id}/callback`,
      // The provider is the issuer, as in transparent mode (#271): an RFC 9207
      // `iss` on its callback and its id_token's `iss` must name it.
      issuer: options.provider,
      additionalIssuers: cfg?.additionalIssuers,
      verifyIssuer: cfg?.verifyIssuer,
    });
  }

  /**
   * Derive a stable provider id from the upstream `provider` base URL, mirroring
   * the detection layer's `deriveProviderId`/`urlToProviderId` (hostname with
   * dots replaced by underscores) so the id is consistent across surfaces.
   */
  private deriveRemoteProviderId(provider: string): string {
    try {
      return new URL(provider).hostname.replace(/\./g, '_');
    } catch {
      return provider.replace(/[^a-zA-Z0-9]/g, '_');
    }
  }

  /**
   * Get provider configuration
   */
  getProviderConfig(providerId: string): UpstreamProviderConfig | undefined {
    return this.providerConfigs.get(providerId);
  }

  /**
   * Build OAuth authorize URL for an upstream provider
   */
  async buildProviderAuthorizeUrl(
    providerId: string,
    params: {
      state: string;
      codeChallenge: string;
      codeChallengeMethod: 'S256';
      scopes?: string[];
    },
  ): Promise<string | null> {
    const config = this.providerConfigs.get(providerId);

    if (!config) {
      this.logger.error(`Provider not found: ${providerId}`);
      return null;
    }

    const url = new URL(config.authorizationEndpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', config.callbackUrl);
    url.searchParams.set('state', params.state);
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', params.codeChallengeMethod);

    const scopes = params.scopes ?? config.scopes;
    if (scopes.length > 0) {
      url.searchParams.set('scope', scopes.join(' '));
    }

    return url.toString();
  }

  /**
   * Exchange authorization code with upstream provider for tokens
   */
  async exchangeProviderCode(
    providerId: string,
    code: string,
    codeVerifier?: string,
  ): Promise<UpstreamTokenResponse | { error: string; error_description: string }> {
    const config = this.providerConfigs.get(providerId);

    if (!config) {
      return {
        error: 'invalid_provider',
        error_description: `Provider not configured: ${providerId}`,
      };
    }

    try {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.callbackUrl,
        client_id: config.clientId,
      });

      // Add client secret for confidential clients
      if (config.clientSecret) {
        body.set('client_secret', config.clientSecret);
      }

      // Add PKCE verifier if provided
      if (codeVerifier) {
        body.set('code_verifier', codeVerifier);
      }

      this.logger.debug(`Exchanging code with provider: ${providerId}`);

      const response = await fetch(config.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        this.logger.error(`Provider token exchange failed: ${response.status}`, errorData);
        return {
          error: errorData.error || 'provider_error',
          error_description: errorData.error_description || `Provider returned ${response.status}`,
        };
      }

      const tokenData = (await response.json()) as UpstreamTokenResponse;

      // Defensive: a 200 MUST carry a usable access_token. A misbehaving upstream
      // (or a proxy under load) can return 200 with an error-ish or empty body that
      // omits `access_token`. Without this guard the federated callback stores an
      // empty credential and still mints a JWT that claims the provider is linked,
      // so `this.orchestration.getToken()` later resolves to null. Treat a tokenless
      // 200 as an exchange error so the flow halts and no tokenless JWT is issued.
      if (typeof tokenData?.access_token !== 'string' || tokenData.access_token.length === 0) {
        this.logger.error(`Provider ${providerId} returned 200 without an access_token`);
        return {
          error: 'provider_error',
          error_description: `Provider ${providerId} did not return an access_token`,
        };
      }

      this.logger.info(`Successfully exchanged code with provider: ${providerId}`);

      return tokenData;
    } catch (err) {
      this.logger.error(`Provider token exchange error for ${providerId}:`, err);
      return {
        error: 'provider_error',
        error_description: `Failed to exchange code with provider: ${err}`,
      };
    }
  }

  /**
   * Get user info from upstream provider
   */
  async getProviderUserInfo(
    providerId: string,
    accessToken: string,
    idToken?: string,
  ): Promise<{ sub: string; email?: string; name?: string; picture?: string; claims?: Record<string, unknown> }> {
    const config = this.providerConfigs.get(providerId);

    // The id_token names the user only when it verifies (#271): signed by a key
    // the provider publishes (`providerConfig.jwks` / `jwksUri`), issued by the
    // provider, for THIS client, and not expired. An id_token that doesn't
    // verify, or can't be (no keys or no issuer configured), is ignored and the
    // identity comes from the userinfo endpoint, which answers for the access
    // token.
    if (idToken && config) {
      const claims = await this.verifyProviderIdToken(config, idToken);
      const sub = typeof claims?.['sub'] === 'string' && claims['sub'].trim() ? claims['sub'] : undefined;
      if (claims && sub) {
        return {
          sub,
          email: claims['email'] as string | undefined,
          name: claims['name'] as string | undefined,
          picture: claims['picture'] as string | undefined,
          claims,
        };
      }
      this.logger.warn(`ID token for ${providerId} was not verified; using the userinfo endpoint for identity`);
    }

    // Try userinfo endpoint if available
    if (config?.userInfoEndpoint) {
      try {
        const response = await fetch(config.userInfoEndpoint, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        });

        if (response.ok) {
          const userInfo = (await response.json()) as Record<string, unknown>;
          const sub =
            typeof userInfo['sub'] === 'string' && userInfo['sub'].trim() ? (userInfo['sub'] as string) : undefined;
          if (sub) {
            return {
              sub,
              email: userInfo['email'] as string | undefined,
              name: userInfo['name'] as string | undefined,
              picture: userInfo['picture'] as string | undefined,
              claims: userInfo,
            };
          }
          this.logger.warn(`userinfo for ${providerId} returned no usable sub`);
        }
      } catch (err) {
        this.logger.warn(`Failed to get userinfo from ${providerId}: ${err}`);
      }
    }

    // SECURITY: no stable identity could be determined. Previously this returned
    // a DETERMINISTIC placeholder `"${providerId}:unknown"`, so every user who
    // authenticated via such a provider collapsed to ONE shared FrontMCP
    // identity (shared session / credential vault → cross-user exposure). Fail
    // closed instead: the caller must abort the federated login.
    throw new Error(
      `Unable to determine a stable user identity from provider "${providerId}" ` +
        `(no id_token sub and no usable userinfo endpoint)`,
    );
  }

  /**
   * Verify an upstream provider's `id_token` and return its claims, or
   * `undefined` when it doesn't verify or no keys are configured to verify it.
   *
   * Checks the signature against the provider's published keys (inline
   * `jwks`, else `jwksUri`, else the provider's discovery document), the
   * issuer (the provider, plus `additionalIssuers`, unless `verifyIssuer` is
   * false), `exp`, and that `aud` names this client. With no issuer configured
   * (a local-mode provider without `issuer`) the token is not used: a key set
   * an IdP shares between tenants would vouch for every tenant's tokens.
   */
  private async verifyProviderIdToken(
    config: UpstreamProviderConfig,
    idToken: string,
  ): Promise<Record<string, unknown> | undefined> {
    if (!config.jwks?.keys?.length && !config.jwksUri) return undefined;
    if (!config.issuer && config.verifyIssuer !== false) {
      this.logger.warn(`ID token for ${config.id} not used: the provider has no configured issuer to check it against`);
      return undefined;
    }
    const result = await this.jwks.verifyTransparentToken(idToken, [
      {
        id: `upstream:${config.id}`,
        issuerUrl: config.issuer ?? '',
        additionalIssuers: config.additionalIssuers,
        verifyIssuer: config.verifyIssuer,
        jwks: config.jwks,
        jwksUri: config.jwksUri,
      },
    ]);
    if (!result.ok || !result.payload) {
      this.logger.warn(`ID token for ${config.id} failed verification: ${result.error ?? 'unknown'}`);
      return undefined;
    }
    const aud = result.payload['aud'];
    const audiences = typeof aud === 'string' ? [aud] : Array.isArray(aud) ? aud : [];
    if (!audiences.includes(config.clientId)) {
      this.logger.warn(`ID token for ${config.id} was issued for another client`);
      return undefined;
    }
    return result.payload;
  }

  /**
   * Refresh tokens from upstream provider
   */
  async refreshProviderToken(
    providerId: string,
    refreshToken: string,
  ): Promise<UpstreamTokenResponse | { error: string; error_description: string }> {
    const config = this.providerConfigs.get(providerId);

    if (!config) {
      return {
        error: 'invalid_provider',
        error_description: `Provider not configured: ${providerId}`,
      };
    }

    try {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: config.clientId,
      });

      if (config.clientSecret) {
        body.set('client_secret', config.clientSecret);
      }

      const response = await fetch(config.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          error: errorData.error || 'provider_error',
          error_description: errorData.error_description || `Provider returned ${response.status}`,
        };
      }

      return (await response.json()) as UpstreamTokenResponse;
    } catch (err) {
      return {
        error: 'provider_error',
        error_description: `Failed to refresh token with provider: ${err}`,
      };
    }
  }

  /**
   * What renews an upstream provider's access token with its refresh token when `this.orchestration`
   * finds it expired, or none with `refresh.enabled: false`. Renewals with the same refresh token
   * share one request: a provider that rotates refresh tokens accepts each only once.
   */
  providerTokenRefresher(): TokenRefreshCallback | undefined {
    if (!isOrchestratedMode(this.options) || this.options.refresh?.enabled === false) return undefined;
    return (providerId, refreshToken) => {
      const key = JSON.stringify([providerId, refreshToken]);
      const inFlight = this.providerRenewals.get(key);
      if (inFlight) return inFlight;
      const renewal = this.renewProviderToken(providerId, refreshToken).finally(() =>
        this.providerRenewals.delete(key),
      );
      this.providerRenewals.set(key, renewal);
      return renewal;
    };
  }

  private async renewProviderToken(providerId: string, refreshToken: string): ReturnType<TokenRefreshCallback> {
    const result = await this.refreshProviderToken(providerId, refreshToken);
    if ('error' in result || typeof result.access_token !== 'string' || !result.access_token) {
      this.logger.warn(
        `Provider ${providerId} did not refresh its token: ${'error' in result ? result.error : 'no access_token'}`,
      );
      throw new TokenNotAvailableError(
        `Provider "${providerId}" did not refresh its token; the user has to sign in again`,
      );
    }
    return { accessToken: result.access_token, refreshToken: result.refresh_token, expiresIn: result.expires_in };
  }

  /** How long before its expiry a provider token is renewed: `refresh.skewSeconds` (default 60), none with `refresh` off. */
  private providerRefreshSkewMs(): number {
    if (!isOrchestratedMode(this.options) || this.options.refresh?.enabled === false) return 0;
    return (this.options.refresh?.skewSeconds ?? 60) * 1000;
  }
}
