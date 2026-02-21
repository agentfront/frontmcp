// auth/flows/session.verify.flow.ts
import {
  authorizationSchema,
  Flow,
  FlowBase,
  FlowRunOptions,
  StageHookOf,
  userClaimSchema,
  sessionIdSchema,
  httpRequestInputSchema,
  FlowPlan,
  isTransparentMode,
  isPublicMode,
  TransparentAuthOptions,
  getRequestBaseUrl,
  normalizeEntryPrefix,
  normalizeScopeBase,
} from '../../common';
import 'reflect-metadata';
import { z } from 'zod';
import { deriveTypedUser, extractBearerToken, isJwt } from '@frontmcp/auth';
import { JwksService, ProviderVerifyRef, VerifyResult } from '@frontmcp/auth';
import { parseSessionHeader, decryptPublicSession } from '../session/utils/session-id.utils';
import { encryptJson } from '@frontmcp/auth';
import { getMachineId } from '@frontmcp/auth';
import { randomUUID } from '@frontmcp/utils';
import { detectPlatformFromUserAgent } from '../../notification/notification.service';

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

export const sessionVerifyOutputSchema = z.union([UnauthorizedSchema, AuthorizedSchema]);

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

  private maskSub(sub: string): string {
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

    // If client sent session ID, use it for transport lookup
    if (sessionIdHeader) {
      const existingPayload = decryptPublicSession(sessionIdHeader);
      const user = existingPayload
        ? { sub: `anon:${existingPayload.iat * 1000}`, iss: issuer, name: 'Anonymous', scope: scopes.join(' ') }
        : { sub: `anon:${randomUUID()}`, iss: issuer, name: 'Anonymous', scope: scopes.join(' ') };

      const finalPayload = existingPayload && existingPayload.nodeId === machineId ? existingPayload : undefined;

      this.respond({
        kind: 'authorized',
        authorization: {
          token: '',
          user,
          session: {
            id: sessionIdHeader,
            payload: finalPayload,
          },
        },
      });
      return;
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
    const prmMetadataHeader = `Bearer resource_metadata="${baseUrl}${prmMetadataPath}"`;

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
        prmMetadataHeader: this.state.required.prmMetadataHeader,
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
          id: primary.remote.id ?? 'default',
          issuerUrl: issuer,
          jwks: primary.remote.jwks,
          jwksUri: primary.remote.jwksUri,
        },
      ];
      verify = jwks.verifyTransparentToken(token, providerRefs);
    } else {
      // Public or orchestrated mode - verify against local gateway keys
      verify = jwks.verifyGatewayToken(token, this.state.required.baseUrl);
    }

    const result = await verify;

    if (result.ok) {
      this.state.set({ jwtPayload: result.payload });
      return;
    }
    this.logger.warn('verifyIfJwt: JWT verification failed', { error: result.error });
    this.respond({
      kind: 'unauthorized',
      prmMetadataHeader: this.state.required.prmMetadataHeader,
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
