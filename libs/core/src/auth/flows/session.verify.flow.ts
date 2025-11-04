// auth/flows/session.verify.flow.ts
import {
  authorizationSchema,
  Flow, FlowBase,
  FlowRunOptions,
  ScopeEntry, ServerRequest, StageHookOf, userClaimSchema,
  RemoteAuthOptions, sessionIdSchema, httpRequestInputSchema,
} from '@frontmcp/sdk';
import 'reflect-metadata';
import { z } from 'zod';
import { getRequestBaseUrl, makeWellKnownPaths, normalizeEntryPrefix, normalizeScopeBase } from '../path.utils';
import {
  deriveTypedUser,
  extractBearerToken,
  isJwt,
} from '../session/utils/auth-token.utils';
import { JwksService, ProviderVerifyRef, VerifyResult } from '../jwks';
import { parseSessionHeader } from '../session/utils/session-id.utils';


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
  .describe('401 Unauthorized with \'WWW-Authenticate\' header for requesting authentication\'');

const AuthorizedSchema = z
  .object({
    kind: z.literal('authorized'),
    authorization: authorizationSchema.describe('Session information if session id is present'),
  })
  .describe('Authorized session information');


export const sessionVerifyOutputSchema = z.union([UnauthorizedSchema, AuthorizedSchema]);
export type SessionVerifyFlowResult = z.infer<typeof sessionVerifyOutputSchema>;

const plan = {
  pre: ['parseInput', 'requireAuthorizationHeader', 'verifyIfJwt'],
  execute: ['deriveUser', 'parseSessionHeader', 'buildAuthorizedOutput'],
};

declare global {
  export interface ExtendFlows {
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
  outputSchema:sessionVerifyOutputSchema,
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
    const sessionProtocol = httpTransportHeader
      ? 'http'
      : sessionIdHeader
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
      // Non-JWT tokens are passed through; user will be mostly empty (the best effort later).
      this.respond({
        kind: 'unauthorized',
        prmMetadataHeader: this.state.required.prmMetadataHeader,
      });
      return;
    }

    // Best-effort verification using locally known keys (gateway/local provider cache).
    let verify: Promise<VerifyResult>;
    // if (this.scope.orchestrated) { // TODO: fix
    //   verify = jwks.verifyGatewayToken(token, this.state.required.baseUrl);
    // } else {
    const primary = this.scope.auth.options as RemoteAuthOptions;
    const issuer = this.scope.auth.issuer;
    const providerRefs: ProviderVerifyRef[] = [
      {
        id: primary.id ?? 'default',
        issuerUrl: issuer,
        jwks: primary.jwks,
        jwksUri: primary.jwksUri,
      },
    ];
    verify = jwks.verifyTransparentToken(token, providerRefs);
    // }
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
    const { sessionIdHeader, required: { token } } = this.state;

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
