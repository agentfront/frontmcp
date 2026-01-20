import { SignJWT } from 'jose';
import { URL } from 'url';
import { randomBytes, randomUUID } from '@frontmcp/utils';
import { FrontMcpAuth, FrontMcpLogger, ProviderScope, ScopeEntry, ServerRequest, JWK } from '../../common';
import {
  PublicAuthOptions,
  OrchestratedLocalOptions,
  OrchestratedRemoteOptions,
  isPublicMode,
  isOrchestratedMode,
  isOrchestratedLocal,
} from '../../common/types/options/auth';
import ProviderRegistry from '../../provider/provider.registry';
import WellKnownPrmFlow from '../flows/well-known.prm.flow';
import WellKnownAsFlow from '../flows/well-known.oauth-authorization-server.flow';
import WellKnownJwksFlow from '../flows/well-known.jwks.flow';
import SessionVerifyFlow from '../flows/session.verify.flow';
import OauthAuthorizeFlow from '../flows/oauth.authorize.flow';
import OauthRegisterFlow from '../flows/oauth.register.flow';
import OauthTokenFlow from '../flows/oauth.token.flow';
import OauthCallbackFlow from '../flows/oauth.callback.flow';
import {
  JwksService,
  AuthorizationStore,
  InMemoryAuthorizationStore,
  AuthorizationCodeRecord,
  verifyPkce,
} from '@frontmcp/auth';
import { CimdService, CimdServiceToken } from '../cimd';

/**
 * Options type for LocalPrimaryAuth - can be public, orchestrated local, or orchestrated remote
 */
export type LocalPrimaryAuthOptions = PublicAuthOptions | OrchestratedLocalOptions | OrchestratedRemoteOptions;

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
}

export class LocalPrimaryAuth extends FrontMcpAuth<LocalPrimaryAuthOptions> {
  readonly host: string;
  readonly port: number;
  readonly issuer: string;
  readonly keys: JWK[] = [];
  readonly secret: Uint8Array;
  readonly logger: FrontMcpLogger;
  readonly authorizationStore: AuthorizationStore;
  private jwks = new JwksService();
  private cimdService: CimdService | undefined;

  /** Default access token TTL (1 hour) */
  private readonly accessTokenTtlSeconds = 3600;
  /** Default refresh token TTL (30 days) */
  private readonly refreshTokenTtlSeconds = 30 * 24 * 3600;

  /**
   * Get the authorization store as InMemoryAuthorizationStore with type guard.
   * This ensures type safety when using InMemory-specific methods.
   */
  private getInMemoryStore(): InMemoryAuthorizationStore {
    if (!(this.authorizationStore instanceof InMemoryAuthorizationStore)) {
      throw new Error('LocalPrimaryAuth requires InMemoryAuthorizationStore for record creation methods');
    }
    return this.authorizationStore;
  }

  constructor(
    private scope: ScopeEntry,
    private providers: ProviderRegistry,
    options: LocalPrimaryAuthOptions,
  ) {
    super(options);
    this.logger = this.providers.getActiveScope().logger.child('LocalPrimaryAuth');
    this.port = this.providers.getActiveScope().metadata.http?.port ?? 3001;
    this.host = 'localhost';
    this.issuer = this.deriveIssuer(options);

    if (process.env['JWT_SECRET']) {
      this.secret = new TextEncoder().encode(process.env['JWT_SECRET']);
    } else {
      this.logger.warn('JWT_SECRET is not set, using default secret');
      this.secret = DEFAULT_NO_AUTH_SECRET;
    }

    // Initialize authorization store (in-memory for now, Redis later)
    this.authorizationStore = new InMemoryAuthorizationStore();

    // Initialize CIMD service if orchestrated mode
    if (isOrchestratedMode(options)) {
      const cimdConfig = options.cimd;
      this.cimdService = new CimdService(this.logger, cimdConfig);
    }

    this.ready = this.initialize();
  }

  /**
   * Derive issuer from options
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

    // Build consent metadata from code record
    const consentMetadata: ConsentMetadata | undefined =
      codeRecord.consentEnabled || codeRecord.federatedLoginUsed
        ? {
            selectedToolIds: codeRecord.selectedToolIds,
            selectedProviderIds: codeRecord.selectedProviderIds,
            skippedProviderIds: codeRecord.skippedProviderIds,
            consentEnabled: codeRecord.consentEnabled,
            federatedLoginUsed: codeRecord.federatedLoginUsed,
          }
        : undefined;

    const accessToken = await this.signAccessToken(user, codeRecord.scopes, codeRecord.resource, consentMetadata);

    // Create refresh token
    const refreshTokenRecord = this.getInMemoryStore().createRefreshTokenRecord({
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
    const newRefreshRecord = this.getInMemoryStore().createRefreshTokenRecord({
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
  }): Promise<string> {
    const store = this.getInMemoryStore();
    const codeRecord = store.createCodeRecord({
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
    });

    await this.authorizationStore.storeAuthorizationCode(codeRecord);
    this.logger.info(`Authorization code created for user: ${params.userSub}`);

    return codeRecord.code;
  }

  protected async initialize(): Promise<void> {
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
      OauthCallbackFlow /** GET /oauth/callback - login callback */,
      OauthRegisterFlow /** POST /oauth/register */,
    );
  }
}
