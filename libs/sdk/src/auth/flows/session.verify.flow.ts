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
  AuthOptions,
  isTransparentMode,
  isPublicMode,
  TransparentAuthOptions,
  getRequestBaseUrl,
  normalizeEntryPrefix,
  normalizeScopeBase,
} from '../../common';
import 'reflect-metadata';
import { z } from 'zod';
import { deriveTypedUser, extractBearerToken, isJwt } from '../session/utils/auth-token.utils';
import { JwksService, ProviderVerifyRef, VerifyResult } from '../jwks';
import { parseSessionHeader, encryptJson, decryptPublicSession } from '../session/utils/session-id.utils';
import { getMachineId } from '../authorization';
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

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema: sessionVerifyOutputSchema,
  access: 'authorized',
})
export default class SessionVerifyFlow extends FlowBase<typeof name> {
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

    const sessionIdHeader = this.state.sessionIdHeader;
    const machineId = getMachineId();

    // CRITICAL: If client sent session ID, ALWAYS use it for transport lookup.
    // The transport registry uses this ID as the key. Creating a different ID
    // would cause "session not initialized" error.
    if (sessionIdHeader) {
      // Try to decrypt/validate for payload extraction (optional - for nodeId validation)
      const existingPayload = decryptPublicSession(sessionIdHeader);

      // Determine user based on whether we could extract payload
      const user = existingPayload
        ? { sub: `anon:${existingPayload.iat * 1000}`, iss: 'public', name: 'Anonymous' }
        : { sub: `anon:${crypto.randomUUID()}`, iss: 'public', name: 'Anonymous' };

      // ALWAYS use client's session ID, regardless of validation result.
      // If payload is valid and nodeId matches, include payload for protocol detection.
      // If validation failed, transport layer will handle the error appropriately.
      const finalPayload = existingPayload && existingPayload.nodeId === machineId ? existingPayload : undefined;

      this.respond({
        kind: 'authorized',
        authorization: {
          token: '',
          user,
          session: {
            id: sessionIdHeader, // ← CRITICAL: Always use client's session ID
            payload: finalPayload,
          },
        },
      });
      return;
    }

    // No session header → create new session (initialize request)
    // For new sessions, don't pre-determine protocol. Let transport handler detect it.
    const now = Date.now();
    const user = { sub: `anon:${crypto.randomUUID()}`, iss: 'public', name: 'Anonymous' };
    const uuid = crypto.randomUUID();

    // Detect platform from User-Agent header for UI rendering support
    const platformDetectionConfig = this.scope.metadata.transport?.platformDetection;
    const platformType = detectPlatformFromUserAgent(this.state.userAgent, platformDetectionConfig);

    // Create a valid session payload matching the SessionIdPayload schema
    // Include platformType if detected (non-unknown) for Tool UI support
    const payload = {
      uuid,
      nodeId: machineId,
      authSig: 'public',
      iat: Math.floor(now / 1000),
      isPublic: true,
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
    const sessionIdHeader = this.state.sessionIdHeader;
    const machineId = getMachineId();
    const authOptions = this.scope.auth?.options as TransparentAuthOptions | undefined;

    // Similar logic to handlePublicMode but for transparent mode with allowAnonymous
    if (sessionIdHeader) {
      const existingPayload = decryptPublicSession(sessionIdHeader);
      const user = existingPayload
        ? { sub: `anon:${existingPayload.iat * 1000}`, iss: 'transparent-anon', name: 'Anonymous' }
        : { sub: `anon:${crypto.randomUUID()}`, iss: 'transparent-anon', name: 'Anonymous' };

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
    const scopes = authOptions?.anonymousScopes ?? ['anonymous'];
    const user = {
      sub: `anon:${crypto.randomUUID()}`,
      iss: 'transparent-anon',
      name: 'Anonymous',
      scope: scopes.join(' '),
    };
    const uuid = crypto.randomUUID();

    const platformDetectionConfig = this.scope.metadata.transport?.platformDetection;
    const platformType = detectPlatformFromUserAgent(this.state.userAgent, platformDetectionConfig);

    const payload = {
      uuid,
      nodeId: machineId,
      authSig: 'transparent-anon',
      iat: Math.floor(now / 1000),
      isPublic: true,
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
    const token = this.state.required.token;

    if (!isJwt(token)) {
      // Non-JWT tokens are not supported - require JWT for verification
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
      this.respond({
        kind: 'unauthorized',
        prmMetadataHeader: this.state.required.prmMetadataHeader,
      });
      return;
    }

    let verify: Promise<VerifyResult>;
    const authOptions = auth.options;

    // Transparent mode uses remote provider's keys, all other modes use local keys
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
