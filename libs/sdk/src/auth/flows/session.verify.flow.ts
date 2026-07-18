// auth/flows/session.verify.flow.ts
import {
  authorizationSchema,
  Flow,
  FlowBase,
  getRequestBaseUrl,
  httpRequestInputSchema,
  isPublicMode,
  isPublicUrlPinned,
  isTransparentMode,
  normalizeEntryPrefix,
  normalizeScopeBase,
  sessionIdSchema,
  StageHookOf,
  userClaimSchema,
  type FlowPlan,
  type FlowRunOptions,
  type TransparentAuthOptions,
} from '../../common';

import 'reflect-metadata';

import {
  buildInsufficientScopeHeader,
  buildInvalidTokenHeader,
  buildUnauthorizedHeader,
  deriveExpectedAudience,
  deriveTypedUser,
  encryptJson,
  extractBearerToken,
  isJwt,
  JwksService,
  validateAudience,
  type ProviderVerifyRef,
  type VerifyResult,
} from '@frontmcp/auth';
import { z } from '@frontmcp/lazy-zod';
import { getMachineId, randomUUID } from '@frontmcp/utils';

import { detectPlatformFromUserAgent } from '../../notification/notification.service';
import { decryptPublicSession, parseSessionHeader } from '../session/utils/session-id.utils';

const inputSchema = httpRequestInputSchema;

const stateSchema = z.object({
  baseUrl: z.string().min(1),
  authorizationHeader: z.string().optional(),
  token: z.string().optional(),
  sessionIdHeader: z.string().optional(), // 'mcp-session-id'
  sessionProtocol: z.string().optional(), // 'sse/http/streamable-http'
  userAgent: z.string().optional(), // User-Agent header for platform detection
  prmMetadataPath: z.string().optional(),
  prmMetadataHeader: z.string().optional(),
  prmUrl: z.string().optional(), // Full PRM URL for header builder functions
  jwtPayload: z.object({}).passthrough().optional(),
  user: userClaimSchema.optional(),
  session: sessionIdSchema.optional(),
});

const UnauthorizedSchema = z
  .object({
    kind: z.literal('unauthorized'),
    prmMetadataHeader: z.string().describe('Path to protected resource metadata'),
  })
  .describe("401 Unauthorized with 'WWW-Authenticate' header for requesting authentication");

const AuthorizedSchema = z
  .object({
    kind: z.literal('authorized'),
    authorization: authorizationSchema.describe('Session information if session id is present'),
  })
  .describe('Authorized session information');

const ForbiddenSchema = z
  .object({
    kind: z.literal('forbidden'),
    prmMetadataHeader: z.string().describe('WWW-Authenticate header with insufficient_scope error'),
  })
  .describe('403 Forbidden — token valid but insufficient scope');

export const sessionVerifyOutputSchema = z.union([UnauthorizedSchema, AuthorizedSchema, ForbiddenSchema]);

const plan = {
  pre: ['parseInput', 'handlePublicMode', 'handleAnonymousFallback', 'requireAuthorizationHeader', 'verifyIfJwt'],
  execute: ['deriveUser', 'parseSessionHeader', 'buildAuthorizedOutput'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'session:verify': FlowRunOptions<
      SessionVerifyFlow,
      typeof plan,
      typeof inputSchema,
      typeof sessionVerifyOutputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'session:verify' as const;
const Stage = StageHookOf(name);

/**
 * Emit the "audience is not pinned" warning at most once per process, so a
 * misconfigured transparent deployment is surfaced without spamming the log on
 * every request.
 */
let warnedUnpinnedAudience = false;

/** Auth mode for session payload - distinguishes between anonymous session types */
type AuthMode = 'public' | 'transparent-anon';

/** Options for creating an anonymous session */
interface AnonymousSessionOptions {
  /** Auth mode: 'public' for public mode, 'transparent-anon' for transparent anonymous */
  authMode: AuthMode;
  /** Issuer identifier for the user claim */
  issuer: string;
  /** Optional scopes for the anonymous user */
  scopes?: string[];
  /** Existing session ID header from client (if present) */
  sessionIdHeader?: string;
}

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema: sessionVerifyOutputSchema,
  access: 'authorized',
})
export default class SessionVerifyFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('SessionVerifyFlow');

  private maskSub(sub: string | undefined): string {
    if (!sub) return '***';
    if (sub.length <= 10) return '***' + sub.slice(-4);
    return sub.slice(0, 6) + '***' + sub.slice(-4);
  }

  /**
   * Create an anonymous session with consistent structure for both public and transparent-anon modes.
   * Encapsulates the shared logic for session creation, payload encryption, and user derivation.
   */
  private createAnonymousSession(options: AnonymousSessionOptions): void {
    const { authMode, issuer, scopes = ['anonymous'], sessionIdHeader } = options;
    this.logger.verbose('createAnonymousSession', { authMode, hasExistingSession: !!sessionIdHeader });
    const machineId = getMachineId();

    // If the client sent a session id, ONLY honor it when it decrypts to a
    // payload THIS server minted for THIS node (valid AES-256-GCM tag). All
    // anonymous sessions share `token: ''`, so the transport registry separates
    // them by session id alone — echoing an arbitrary client-supplied id back
    // verbatim let an attacker fixate a chosen id or, by presenting a victim's
    // leaked id, resolve the victim's live transport (notifications/elicitations).
    // An unrecognized / forged id is IGNORED and a fresh server-minted id is
    // issued below, so the client cannot choose its own anonymous identity.
    if (sessionIdHeader) {
      const existingPayload = decryptPublicSession(sessionIdHeader);
      if (existingPayload && existingPayload.nodeId === machineId) {
        // Derive the anonymous `sub` from the session's unique `uuid` (not its
        // one-second `iat`, which collided for sessions minted in the same
        // second and shared a `sub`-keyed partition, e.g. the rate limiter).
        const anonId = existingPayload.uuid ?? `${existingPayload.iat * 1000}`;
        const user = { sub: `anon:${anonId}`, iss: issuer, name: 'Anonymous', scope: scopes.join(' ') };
        this.respond({
          kind: 'authorized',
          authorization: {
            token: '',
            user,
            session: { id: sessionIdHeader, payload: existingPayload },
          },
        });
        return;
      }
      // Fall through: mint a fresh, server-controlled anonymous session and
      // ignore the untrusted client-supplied id.
      this.logger.verbose('createAnonymousSession: ignoring unrecognized client session id; minting a fresh one');
    }

    // Create new anonymous session
    const now = Date.now();
    const user = {
      sub: `anon:${randomUUID()}`,
      iss: issuer,
      name: 'Anonymous',
      scope: scopes.join(' '),
    };
    const uuid = randomUUID();

    // Detect platform from User-Agent header for UI rendering support
    const platformDetectionConfig = this.scope.metadata.transport?.platformDetection;
    const platformType = detectPlatformFromUserAgent(this.state.userAgent, platformDetectionConfig);

    // Create session payload with explicit authMode to distinguish session types
    // - authMode: 'public' for public mode, 'transparent-anon' for transparent anonymous
    // - isPublic: true only for 'public' mode, false for 'transparent-anon'
    const payload = {
      uuid,
      nodeId: machineId,
      authSig: authMode,
      iat: Math.floor(now / 1000),
      isPublic: authMode === 'public',
      authMode,
      ...(platformType !== 'unknown' && { platformType }),
    };

    const sessionId = encryptJson(payload);

    this.respond({
      kind: 'authorized',
      authorization: {
        token: '',
        user,
        session: { id: sessionId, payload },
      },
    });
  }

  @Stage('parseInput')
  async parseInput() {
    const { request } = this.rawInput;
    const entryPath = normalizeEntryPrefix(this.scope.entryPath);
    const routeBase = normalizeScopeBase(this.scope.routeBase);
    const baseUrl = getRequestBaseUrl(request, entryPath);

    const authorizationHeader = (request.headers?.['authorization'] as string | undefined) ?? undefined;
    const httpTransportHeader = request.headers?.['http-transport'] as string | undefined;
    const sessionIdRawHeader = request.headers?.['mcp-session-id'] as string | undefined;
    const sessionIdQuery = request.query['sessionId'] as string | undefined;

    const sessionIdHeader = sessionIdRawHeader ?? sessionIdQuery ?? undefined;
    // Use sessionIdRawHeader (not sessionIdHeader) to distinguish header vs query param
    // sessionIdHeader is the merged value, but we need to know the source for protocol selection
    const sessionProtocol = httpTransportHeader
      ? 'http'
      : sessionIdRawHeader
        ? 'streamable-http'
        : sessionIdQuery
          ? 'sse'
          : undefined;

    const token = extractBearerToken(authorizationHeader);
    const userAgent = (request.headers?.['user-agent'] as string | undefined) ?? undefined;

    const prmMetadataPath = `/.well-known/oauth-protected-resource${entryPath}${routeBase}`;
    // `prmMetadataPath` already carries `entryPath`, so the PRM URL is built from
    // the ORIGIN (not `baseUrl`, which is origin+entryPath and is kept for token
    // audience verification). Using `baseUrl` here double-counted `entryPath`
    // (e.g. `/mcp/.well-known/oauth-protected-resource/mcp`), so the
    // `WWW-Authenticate` `resource_metadata` URL 404'd for any non-root entryPath.
    const prmUrl = `${getRequestBaseUrl(request)}${prmMetadataPath}`;
    const prmMetadataHeader = buildUnauthorizedHeader(prmUrl);

    this.logger.verbose('parseInput', {
      hasAuthHeader: !!authorizationHeader,
      hasToken: !!token,
      sessionProtocol,
      hasSessionId: !!sessionIdHeader,
    });

    this.state.set({
      baseUrl,
      authorizationHeader,
      token,
      sessionIdHeader,
      sessionProtocol,
      userAgent,
      prmMetadataPath,
      prmMetadataHeader,
      prmUrl,
    });
  }

  /**
   * Handle public mode - allow anonymous access without requiring authorization
   * In public mode, we create an anonymous authorization with a stateful session
   * but NO token. This allows public docs/CI to work without Authorization header.
   *
   * CRITICAL: When client sends mcp-session-id header, we MUST use that exact ID
   * for transport registry lookup. Creating a new session ID would cause mismatch.
   */
  @Stage('handlePublicMode')
  async handlePublicMode() {
    const authOptions = this.scope.auth?.options;

    // Skip if not public mode or if authorization header is present (authenticated public)
    if (!authOptions || !isPublicMode(authOptions)) {
      return;
    }

    // If token is present, let the normal verification flow handle it
    if (this.state.token) {
      return;
    }

    this.logger.info('handlePublicMode: allowing anonymous access (public mode)');

    // Use shared helper for anonymous session creation
    this.createAnonymousSession({
      authMode: 'public',
      issuer: 'public',
      scopes: ['public'],
      sessionIdHeader: this.state.sessionIdHeader,
    });
  }

  /**
   * Handle transparent mode with allowAnonymous when no token is provided
   * This creates an anonymous session similar to public mode but for transparent auth
   */
  @Stage('handleAnonymousFallback', {
    filter: ({ state, scope }) => {
      // Only process if no token and auth is transparent with allowAnonymous
      if (state.token) return false;
      const authOptions = scope.auth?.options;
      if (!authOptions || !isTransparentMode(authOptions)) return false;
      return (authOptions as TransparentAuthOptions).allowAnonymous === true;
    },
  })
  async handleAnonymousFallback() {
    this.logger.verbose('handleAnonymousFallback: creating anonymous session (transparent-anon)');
    const authOptions = this.scope.auth?.options as TransparentAuthOptions | undefined;
    const scopes = authOptions?.anonymousScopes ?? ['anonymous'];

    // Use shared helper for anonymous session creation
    this.createAnonymousSession({
      authMode: 'transparent-anon',
      issuer: 'transparent-anon',
      scopes,
      sessionIdHeader: this.state.sessionIdHeader,
    });
  }

  @Stage('requireAuthorizationHeader', {
    filter: ({ state, scope }) => {
      // Don't require auth if we already have an authorization header
      if (state.authorizationHeader) return false;
      // Don't require auth in public mode
      const authOptions = scope.auth?.options;
      if (authOptions && isPublicMode(authOptions)) return false;
      // Don't require auth if transparent mode with allowAnonymous (handled by handleAnonymousFallback)
      if (authOptions && isTransparentMode(authOptions)) {
        if ((authOptions as TransparentAuthOptions).allowAnonymous === true) return false;
      }
      return true;
    },
  })
  async requireAuthorizationOrChallenge() {
    this.logger.verbose('requireAuthorizationOrChallenge: returning 401');
    this.respond({
      kind: 'unauthorized',
      prmMetadataHeader: this.state.required.prmMetadataHeader,
    });
  }

  /**
   * If Authorization is a JWT:
   *  - Attempt verification against any known / cached public keys we have (gateway/local)
   *  - If verification fails → 401
   *  - If verification ok → capture payload
   * If NOT a JWT:
   *  - we do NOT attempt verification, just pass the raw token through
   */
  @Stage('verifyIfJwt')
  async verifyIfJwt() {
    const jwks = this.get(JwksService); // TODO: fix providers
    const token = this.state.token;

    // Handle missing/empty token (e.g., "Bearer " or non-Bearer scheme like "Basic xxx")
    // When authorizationHeader exists but extractBearerToken returns undefined,
    // we should return 401 rather than throwing an error
    if (!token) {
      this.logger.warn('verifyIfJwt: missing or empty bearer token, returning 401');
      this.respond({
        kind: 'unauthorized',
        prmMetadataHeader: this.state.required.prmMetadataHeader,
      });
      return;
    }

    if (!isJwt(token)) {
      // Non-JWT tokens are not supported - require JWT for verification
      this.logger.warn('verifyIfJwt: token is not a JWT, returning 401');
      this.respond({
        kind: 'unauthorized',
        prmMetadataHeader: buildInvalidTokenHeader(this.state.required.prmUrl, 'Token is not a valid JWT'),
      });
      return;
    }

    // Best-effort verification using locally known keys (gateway/local provider cache).
    // Add defensive null check for this.scope.auth (consistent with line 130)
    const auth = this.scope.auth;
    if (!auth) {
      this.logger.warn('verifyIfJwt: auth registry not available, returning 401');
      this.respond({
        kind: 'unauthorized',
        prmMetadataHeader: this.state.required.prmMetadataHeader,
      });
      return;
    }

    let verify: Promise<VerifyResult>;
    const authOptions = auth.options;

    // Transparent mode uses remote provider's keys, all other modes use local keys
    const mode = isTransparentMode(authOptions) ? 'transparent' : 'gateway';
    this.logger.verbose(`verifyIfJwt: verifying using ${mode} mode`);
    if (isTransparentMode(authOptions)) {
      const primary = authOptions as TransparentAuthOptions;
      const issuer = auth.issuer;
      const providerRefs: ProviderVerifyRef[] = [
        {
          id: primary.providerConfig?.id ?? 'default',
          issuerUrl: issuer,
          additionalIssuers: primary.providerConfig?.additionalIssuers,
          verifyIssuer: primary.providerConfig?.verifyIssuer,
          jwks: primary.providerConfig?.jwks,
          jwksUri: primary.providerConfig?.jwksUri,
        },
      ];
      verify = jwks.verifyTransparentToken(token, providerRefs);
    } else {
      // Public or orchestrated (gateway) mode — verify the token's HS256
      // signature + expiration using the auth instance's own secret. The
      // instance is the sole holder of the signing key, so verification lives
      // there (LocalPrimaryAuth.verifyGatewayToken) rather than in JwksService.
      verify = auth.verifyGatewayToken(token, this.state.required.baseUrl);
    }

    const result = await verify;

    if (result.ok) {
      this.state.set({ jwtPayload: result.payload });

      // Validate audience (RFC 8707 / MCP Authorization spec) in transparent
      // mode. Transparent tokens are verified against an EXTERNAL IdP's shared
      // JWKS, so a valid signature only proves the IdP minted the token — not
      // that it was minted for THIS resource. The `aud` claim is the sole
      // binding to this server; without this gate a token issued to the same
      // IdP for a different service authenticates here unchanged
      // (GHSA-hvvp-67p3-j379). Gateway/public tokens are excluded on purpose:
      // they are HS256-signed with this instance's own secret, so a token from
      // another service simply fails signature verification — an audience gate
      // there would add no security and risks rejecting legitimate
      // resource-scoped tokens whose `aud` is the OAuth `resource` indicator.
      if (isTransparentMode(authOptions)) {
        const configuredAudience = (authOptions as TransparentAuthOptions).expectedAudience;
        // SECURITY: when `expectedAudience` is not configured we derive it from
        // `baseUrl`. `baseUrl` comes from `getRequestBaseUrl`, which now ignores
        // `X-Forwarded-*` unless a trusted proxy / `FRONTMCP_PUBLIC_URL` is set —
        // so an attacker can no longer set `X-Forwarded-Host` to make the
        // expected audience match a token minted for another service. For the
        // strongest binding, operators should pin `FRONTMCP_PUBLIC_URL` or set
        // `expectedAudience`; warn once when neither is present.
        if (!configuredAudience && !isPublicUrlPinned() && !warnedUnpinnedAudience) {
          warnedUnpinnedAudience = true;
          this.logger.warn(
            'transparent audience validation is deriving the expected audience from the request Host: ' +
              'set auth.expectedAudience or FRONTMCP_PUBLIC_URL to bind tokens to a fixed resource. ' +
              'X-Forwarded-Host is ignored unless FRONTMCP_TRUST_PROXY is enabled.',
          );
        }
        const expectedAudiences = configuredAudience
          ? Array.isArray(configuredAudience)
            ? configuredAudience
            : [configuredAudience]
          : deriveExpectedAudience(this.state.required.baseUrl);
        const audResult = validateAudience(result.payload?.['aud'] as string | string[] | undefined, {
          expectedAudiences,
          // Accept tokens with no `aud` claim: many IdPs omit it, and rejecting
          // them here would break existing transparent deployments. Tokens that
          // DO carry an `aud` for another service are still rejected, which is
          // what blocks the cross-service replay in GHSA-hvvp-67p3-j379.
          allowNoAudience: true,
        });
        if (!audResult.valid) {
          this.logger.warn('verifyIfJwt: audience validation failed', { error: audResult.error });
          this.respond({
            kind: 'unauthorized',
            prmMetadataHeader: buildInvalidTokenHeader(
              this.state.required.prmUrl,
              audResult.error ?? 'Token audience is not valid for this resource',
            ),
          });
          return;
        }
      }

      // Check required scopes (RFC 6750 §3.1 — insufficient_scope → 403)
      const requiredScopes = (authOptions as Record<string, unknown> | undefined)?.['requiredScopes'] as
        | string[]
        | undefined;
      if (requiredScopes && requiredScopes.length > 0) {
        const scopeClaim = result.payload?.['scope'];
        const tokenScopes =
          typeof scopeClaim === 'string'
            ? scopeClaim.split(/\s+/).filter(Boolean)
            : Array.isArray(scopeClaim)
              ? (scopeClaim as string[])
              : [];
        const hasAll = requiredScopes.every((s: string) => tokenScopes.includes(s));
        if (!hasAll) {
          this.logger.warn('verifyIfJwt: insufficient scopes', {
            required: requiredScopes,
            actual: tokenScopes,
          });
          this.respond({
            kind: 'forbidden',
            prmMetadataHeader: buildInsufficientScopeHeader(this.state.required.prmUrl, requiredScopes),
          });
          return;
        }
      }

      return;
    }
    this.logger.warn('verifyIfJwt: JWT verification failed', { error: result.error });
    this.respond({
      kind: 'unauthorized',
      prmMetadataHeader: buildInvalidTokenHeader(
        this.state.required.prmUrl,
        result.error ?? 'Token verification failed',
      ),
    });
  }

  @Stage('deriveUser')
  async deriveUser() {
    this.state.set('user', deriveTypedUser(this.state.required.jwtPayload ?? {}));
  }

  /**
   * Parse the session header (mcp-session-id)
   * - If session id is present, validate it
   * - If valid, capture the session info
   * - If NOT valid, ignore (no session)
   */
  @Stage('parseSessionHeader')
  async parseSessionHeader() {
    const {
      sessionIdHeader,
      required: { token },
    } = this.state;

    const session = parseSessionHeader(sessionIdHeader, token);
    this.logger.verbose('parseSessionHeader', { hasSessionId: !!sessionIdHeader, parsed: !!session });
    if (session) {
      this.state.set('session', session);
    }
  }

  @Stage('buildAuthorizedOutput')
  async buildAuthorizedOutput() {
    const {
      required: { token, user },
      session,
    } = this.state;

    this.logger.info('Session verified successfully', {
      sub: this.maskSub(user.sub),
      hasSession: !!session,
    });

    this.respond({
      kind: 'authorized',
      authorization: {
        token,
        user,
        session,
      },
    });
  }
}
