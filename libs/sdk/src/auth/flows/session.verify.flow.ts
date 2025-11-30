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

const inputSchema = httpRequestInputSchema;

const stateSchema = z.object({
  baseUrl: z.string().min(1),
  authorizationHeader: z.string().optional(),
  token: z.string().optional(),
  sessionIdHeader: z.string().optional(), // 'mcp-session-id'
  sessionProtocol: z.string().optional(), // 'sse/http/streamable-http'
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
  pre: ['parseInput', 'handlePublicMode', 'requireAuthorizationHeader', 'verifyIfJwt'],
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

    const prmMetadataPath = `/.well-known/oauth-protected-resource${entryPath}${routeBase}`;
    const prmMetadataHeader = `Bearer resource_metadata="${baseUrl}${prmMetadataPath}"`;

    this.state.set({
      baseUrl,
      authorizationHeader,
      token,
      sessionIdHeader,
      sessionProtocol,
      prmMetadataPath,
      prmMetadataHeader,
    });
  }

  /**
   * Handle public mode - allow anonymous access without requiring authorization
   * In public mode, we create an anonymous authorization with a stateful session
   * but NO token. This allows public docs/CI to work without Authorization header.
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

    // For new sessions (no existing session header), don't pre-determine the protocol.
    // Let the router stage in http.request.flow determine the intent from the request.
    // This ensures GET /sse correctly routes to legacy-sse instead of defaulting to streamable-http.
    const sessionIdHeader = this.state.sessionIdHeader;

    // Only use protocol from session header if one was provided (existing session)
    // For new sessions, protocol will be set by the transport handler after intent detection
    const protocol = sessionIdHeader ? this.state.sessionProtocol : undefined;
    const machineId = getMachineId();

    // Check if we have an existing public session to reuse (encrypted format with isPublic: true)
    if (sessionIdHeader) {
      const existingPayload = decryptPublicSession(sessionIdHeader);
      if (existingPayload && existingPayload.nodeId === machineId) {
        // Reuse existing public session
        const user = { sub: `anon:${existingPayload.iat * 1000}`, iss: 'public', name: 'Anonymous' };

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
    }

    // No existing public session - create a new one
    const now = Date.now();

    // Public mode without token - create anonymous authorization WITH stateful session
    // Session is required for transport layer to function correctly
    // Use crypto.randomUUID() for unique anonymous user ID to avoid collision under concurrent requests
    const user = { sub: `anon:${crypto.randomUUID()}`, iss: 'public', name: 'Anonymous' };
    const uuid = crypto.randomUUID();

    // Validate protocol value before assignment to ensure type safety
    const validProtocols = ['sse', 'legacy-sse', 'streamable-http', 'stateful-http', 'stateless-http'] as const;
    type ValidProtocol = (typeof validProtocols)[number];
    const validatedProtocol: ValidProtocol | undefined =
      protocol && validProtocols.includes(protocol as ValidProtocol) ? (protocol as ValidProtocol) : undefined;

    // Create a valid session payload matching the SessionIdPayload schema
    const payload = {
      uuid,
      nodeId: machineId,
      authSig: 'public',
      iat: Math.floor(now / 1000),
      protocol: validatedProtocol,
      isPublic: true,
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
    filter: ({ state }) => !state.authorizationHeader,
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
