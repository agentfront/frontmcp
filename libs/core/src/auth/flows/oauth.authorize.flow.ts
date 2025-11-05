/**
 * Authorization Endpoint — GET /oauth/authorize
 *
 * Who calls: Browser via the Client (RP).
 *
 * When: Start of the flow.
 *
 * Purpose: Authenticate the user and obtain consent; returns an authorization code to the client’s redirect URI.
 *
 * Notes: Must support PKCE. Implicit/Hybrid are out in OAuth 2.1.
 */
/**
 * Typical parameter shapes
 *
 * /oauth/authorize (GET)
 *
 * response_type=code, client_id, redirect_uri, scope, state, code_challenge, code_challenge_method=S256, (optionally request_uri from PAR)
 */
import {
  Flow, FlowBase,
  FlowRunOptions, FrontMcpAuth, FrontMcpAuthProviderTokens, FrontMcpServer, FrontMcpTokens,
  httpInputSchema,
  HttpRedirectSchema, httpRespond,
  HttpTextSchema,
  StageHookOf
} from "@frontmcp/sdk";
import {z} from "zod";

/**
 * Quick checklist (security & correctness)
 * - PKCE (S256) required for public clients (and basically for all).
 * - Use authorization code grant only (no implicit/hybrid).
 * - Rotate refresh tokens and bind them to client + user + scopes.
 * - Prefer private_key_jwt or mTLS for confidential clients.
 * - PAR + JAR recommended for higher security.
 * - Consider DPoP (proof-of-possession) to reduce token replay.
 * - Keep codes very short-lived (e.g., ≤60 s) and single-use.
 * - Publish discovery and JWKS, rotate keys safely.
 * - Decide JWT vs opaque access tokens; provide introspection if opaque.
 */
const inputSchema = httpInputSchema;

const stateSchema = z.object({
  isDefaultAuthProvider: z.boolean().describe("If FrontMcp initialized without auth options"),
  isOrchestrated: z.boolean().describe("If FrontMcp is orchestrated (local oauth proxy, remote oauth proxy)"),
  allowAnonymous: z.boolean().describe('Allow anonymous access, force orchestrated mode'),
  redirectUri: z.string().optional().describe('Oauth Redirect url')
});

const outputSchema = z.union([
  HttpRedirectSchema, // for account/login or oauth/callback
  HttpTextSchema,
]);


const plan = {
  pre: [
    'parseInput',
    'validateInput',
    'checkIfAuthorized', // used for direct code generation if refresh-token is provided
  ],
  execute: [
    'prepareAuthorizationRequest',
    'buildAuthorizeOutput'
  ],
  post: [
    'validateOutput',
  ],
};


declare global {
  export interface ExtendFlows {
    'oauth:authorize': FlowRunOptions<
      OauthAuthorizeFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'oauth:authorize' as const;
const Stage = StageHookOf(name);

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'public',
  middleware: {
    method: 'GET',
    path: '/oauth/authorize',
  },
})
export default class OauthAuthorizeFlow extends FlowBase<typeof name> {

  @Stage('parseInput')
  async parseInput() {
    const {metadata} = this.scope;
    const {request} = this.rawInput;

    const redirectUri = request.query['redirect_uri'];

    if (!metadata.auth) {
      this.state.set({
        isOrchestrated: true,
        allowAnonymous: true,
        isDefaultAuthProvider: true,
        redirectUri,
      })
    } else {
      this.next()
    }
  }

  @Stage('validateInput')
  async validateInput() {
    if (this.state.isDefaultAuthProvider) {
      const redirectUri = `${this.state.redirectUri}?code=anonymous`;
      this.respond(httpRespond.redirect(redirectUri))
    }
    /**
     * check if redirect url valid
     * check allowed origin
     * check if valid authorize request (scope/challenge/state)
     */
  }

  @Stage('checkIfAuthorized')
  async checkIfAuthorized() {
    // TBD
  }

  @Stage('prepareAuthorizationRequest')
  async prepareAuthorizationRequest() {
    // TBD
  }

  @Stage('buildAuthorizeOutput')
  async buildAuthorizeOutput() {
    // TBD
  }

  @Stage('validateOutput')
  async validateOutput() {
    // TBD
  }
}