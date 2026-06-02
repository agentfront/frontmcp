import { jwtVerify, SignJWT } from 'jose';

import {
  createTokenStorageAdapter,
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
  verifyPkce,
  type AuthorizationStore,
  type ConsentStore,
  type FederatedAuthSessionStore,
  type TokenStorageConfig,
  type OrchestratedTokenStore as TokenStore,
  type VerifyResult,
} from '@frontmcp/auth';
import {
  base64urlDecode,
  getEnv,
  MemoryStorageAdapter,
  randomBytes,
  randomUUID,
  sha256Hex,
  type StorageAdapter,
} from '@frontmcp/utils';

import {
  FrontMcpAuth,
  ProviderScope,
  type FrontMcpLogger,
  type JWK,
  type ScopeEntry,
  type ServerRequest,
} from '../../common';
import {
  isLocalMode,
  isOrchestratedLocal,
  isOrchestratedMode,
  isPublicMode,
  isRemoteMode,
  type LocalAuthOptions,
  type PublicAuthOptions,
  type RemoteAuthOptions,
} from '../../common/types/options/auth';
import { installContextExtensions } from '../../context/context-extension';
import type ProviderRegistry from '../../provider/provider.registry';
import { CimdService } from '../cimd';
import { createCredentialsProviders } from '../credentials';
import { credentialsContextExtension } from '../credentials/credentials.context-extension';
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

/**
 * Options type for LocalPrimaryAuth - can be public, orchestrated local, or orchestrated remote
 */
export type LocalPrimaryAuthOptions = PublicAuthOptions | LocalAuthOptions | RemoteAuthOptions;

const DEFAULT_NO_AUTH_SECRET = randomBytes(32);

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
  /** Client ID */
  clientId: string;
  /** Client secret (for confidential clients) */
  clientSecret?: string;
  /** Default scopes to request */
  scopes: string[];
  /** Callback URL for this provider */
  callbackUrl: string;
}

export class LocalPrimaryAuth extends FrontMcpAuth<LocalPrimaryAuthOptions> {
  readonly host: string;
  readonly port: number;
  readonly issuer: string;
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

  /** Storage adapter backing the persistent stores (kept for disposal). */
  private storageAdapter?: StorageAdapter;

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

  /** Provider configurations (indexed by provider ID) */
  private readonly providerConfigs = new Map<string, UpstreamProviderConfig>();

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
    this.port = this.providers.getActiveScope().metadata.http?.port ?? 3001;
    // Boot-time host fallback for the issuer. Previously hard-coded to
    // 'localhost', which produced wrong issuer/discovery URLs behind a proxy
    // or tunnel (#467). An explicit `local.issuer` (preferred) or the
    // FRONTMCP_PUBLIC_HOST env var override this; otherwise fall back to
    // 'localhost'. Request-derived discovery (well-known flows) is the runtime
    // source of truth — this only affects boot-time defaults.
    this.host = getEnv('FRONTMCP_PUBLIC_HOST')?.trim() || 'localhost';
    this.issuer = this.deriveIssuer(options);

    const jwtSecret = getEnv('JWT_SECRET');
    if (jwtSecret) {
      this.secret = new TextEncoder().encode(jwtSecret);
    } else {
      this.logger.warn('JWT_SECRET is not set, using default secret');
      this.secret = DEFAULT_NO_AUTH_SECRET;
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
    });
    this.consentStoreImpl = new InMemoryConsentStore();

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
    const basePath = `http://${this.host}:${this.port}${this.scope.fullPath}`;

    if (isPublicMode(options)) {
      return options.issuer ?? basePath;
    }

    if (isOrchestratedMode(options)) {
      if (isOrchestratedLocal(options)) {
        return options.local?.issuer ?? basePath;
      } else {
        // Orchestrated remote
        return options.local?.issuer ?? basePath;
      }
    }

    return basePath;
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
    const signingSecret = new TextDecoder().decode(this.secret);
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

  async signAnonymousJwt() {
    const sub = randomUUID();
    return new SignJWT({ sub, role: 'user', anonymous: true })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setIssuer(this.issuer)
      .setExpirationTime('1d')
      .sign(this.secret);
  }

  /**
   * Cryptographically verify a gateway-issued access token (public/local/remote
   * "gateway" modes). Gateway tokens — both authenticated access tokens
   * ({@link signAccessToken}) and anonymous tokens ({@link signAnonymousJwt}) —
   * are HS256-signed with `this.secret`, so this instance is the sole holder of
   * the verification key.
   *
   * Enforces the signature and lifetime claims (`exp`/`nbf`, checked by `jose`
   * by default). Issuer equality is intentionally NOT enforced: proxy/tunnel
   * deployments legitimately present an `iss` that differs from the
   * request-derived base URL (see {@link deriveIssuer}). Algorithm is pinned to
   * HS256 to block `alg` confusion (e.g. a forged `alg: none` or asymmetric
   * header). `expectedIssuer` is accepted for parity/logging only.
   */
  override async verifyGatewayToken(token: string, expectedIssuer: string): Promise<VerifyResult> {
    try {
      const { payload, protectedHeader } = await jwtVerify(token, this.secret, {
        algorithms: ['HS256'],
      });
      return {
        ok: true,
        issuer: (payload.iss as string | undefined) ?? expectedIssuer,
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
      .setIssuer(this.issuer)
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
  ): Promise<TokenResponse | { error: string; error_description: string }> {
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
      // Security: If a code is reused, revoke all tokens from this code
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

    const accessToken = await this.signAccessToken(user, codeRecord.scopes, codeRecord.resource, consentMetadata);

    // Migrate tokens from pending to real authorization ID (for federated auth)
    if (codeRecord.pendingAuthId && codeRecord.federatedLoginUsed) {
      try {
        const pendingAuthId = `pending:${codeRecord.pendingAuthId}`;
        // Compute the new authorization ID from the JWT signature (same as OrchestratedAuthorization.generateAuthorizationId)
        const parts = accessToken.split('.');
        const signature = parts[2] || accessToken;
        const newAuthId = sha256Hex(signature).substring(0, 16);

        await this.orchestratedTokenStore.migrateTokens(pendingAuthId, newAuthId);
        this.logger.info(`Migrated tokens from ${pendingAuthId} to ${newAuthId}`);
      } catch (err) {
        // Log but don't fail the token exchange
        this.logger.warn(`Failed to migrate tokens: ${err}`);
      }
    }

    // Create refresh token
    const refreshTokenRecord = this.authorizationStore.createRefreshTokenRecord({
      clientId,
      userSub: user.sub,
      scopes: codeRecord.scopes,
      resource: codeRecord.resource,
    });
    await this.authorizationStore.storeRefreshToken(refreshTokenRecord);

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
   * Refresh an access token using a refresh token
   */
  async refreshAccessToken(
    refreshToken: string,
    clientId: string,
  ): Promise<TokenResponse | { error: string; error_description: string }> {
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

    // Generate new access token
    const user: UserInfo = { sub: tokenRecord.userSub };
    const accessToken = await this.signAccessToken(user, tokenRecord.scopes, tokenRecord.resource);

    // Rotate refresh token
    const newRefreshRecord = this.authorizationStore.createRefreshTokenRecord({
      clientId,
      userSub: tokenRecord.userSub,
      scopes: tokenRecord.scopes,
      resource: tokenRecord.resource,
    });
    await this.authorizationStore.rotateRefreshToken(refreshToken, newRefreshRecord);

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

    // TODO: create separated jwk service for local/remote auth options
    this.providers.injectProvider({
      value: this.jwks,
      metadata: {
        scope: ProviderScope.GLOBAL,
        name: 'auth:jwk-service',
      },
      provide: JwksService,
    });

    // Register CIMD service if initialized
    if (this.cimdService) {
      this.providers.injectProvider({
        value: this.cimdService,
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
    );
  }

  // ============================================
  // Upstream Provider OAuth Methods
  // ============================================

  /**
   * Register an upstream OAuth provider configuration
   */
  registerProvider(config: UpstreamProviderConfig): void {
    this.providerConfigs.set(config.id, config);
    this.logger.info(`Registered upstream provider: ${config.id}`);
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
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      scopes: options.scopes ?? ['openid'],
      callbackUrl: `${this.issuer}/oauth/provider/${id}/callback`,
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

    // If ID token is provided, extract user info from it
    if (idToken) {
      try {
        // Decode ID token (without verification - verification should happen separately)
        const [, payloadB64] = idToken.split('.');
        const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64))) as Record<string, unknown>;

        return {
          sub: payload['sub'] as string,
          email: payload['email'] as string | undefined,
          name: payload['name'] as string | undefined,
          picture: payload['picture'] as string | undefined,
          claims: payload,
        };
      } catch (err) {
        this.logger.warn(`Failed to parse ID token for ${providerId}: ${err}`);
        // Fall through to userinfo endpoint
      }
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
          return {
            sub: userInfo['sub'] as string,
            email: userInfo['email'] as string | undefined,
            name: userInfo['name'] as string | undefined,
            picture: userInfo['picture'] as string | undefined,
            claims: userInfo,
          };
        }
      } catch (err) {
        this.logger.warn(`Failed to get userinfo from ${providerId}: ${err}`);
      }
    }

    // Return minimal user info
    return {
      sub: `${providerId}:unknown`,
    };
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
}
