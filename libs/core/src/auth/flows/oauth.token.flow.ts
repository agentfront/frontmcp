/**
 * Token Endpoint — POST /oauth/token
 *
 * Who calls: Client (server-to-server).
 *
 * When: After getting the code (or for refresh).
 *
 * Purpose: Exchange authorization code + PKCE verifier for access token (and optional refresh token), or refresh an access token.
 */
/**
 * Typical parameter shapes
 *
 * /oauth/token (POST, application/x-www-form-urlencoded)
 *
 * For code exchange: grant_type=authorization_code, code, redirect_uri, client_id (and auth), code_verifier
 *
 * For refresh: grant_type=refresh_token, refresh_token, client_id (and auth)
 */
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

/**
 *
 * OAuth 2.0 Device Authorization Grant (“device code flow”)
 * Who does what (at a glance)
 *
 * Device/TV/CLI (no browser)
 * Calls POST /oauth/device_authorization, shows the user a code + URL, and polls POST /oauth/token.
 *
 * User (on phone/laptop browser)
 * Visits the given verification_uri and authenticates using your normal OAuth login (whatever you already have). No new UI required beyond two tiny endpoints.
 *
 * Auth Server (you)
 * Stores the device transaction and, after the user authenticates, marks it as approved so the device’s /oauth/token polling succeeds.
 *
 * Endpoints you need (only two “new” ones)
 *
 * POST /oauth/device_authorization ✅ (device calls)
 *
 * POST /oauth/token with grant urn:ietf:params:oauth:grant-type:device_code ✅ (device polls)
 *
 * GET /activate ➜ “UI handler” (user lands here from verification_uri — this just redirects into your existing /oauth/authorize)
 *
 * GET /activate/callback ➜ “UI handler” (your existing flow returns here after the user logs in; you flip the device record to approved and show a basic “All set” page)
 *
 * That’s it. No pages with complex consent screens are required; reuse your normal /oauth/authorize
 */

import {
  Flow, FlowBase,
  FlowRunOptions,
  httpInputSchema, HttpJsonSchema,
  httpRespond,
  StageHookOf
} from "@frontmcp/sdk";
import {z} from "zod";
import {randomUUID} from "crypto";
import {LocalPrimaryAuth} from "../instances/instance.local-primary-auth";


const inputSchema = httpInputSchema;

// RFC 7636 PKCE: code_verifier is 43–128 chars from ALPHA / DIGIT / "-" / "." / "_" / "~"
const pkceVerifierRegex = /^[A-Za-z0-9_.~-]{43,128}$/; // TODO: move to shared regex utils
const authorizationCodeGrant = z.object({
  grant_type: z.literal("authorization_code"),
  /** Authorization code returned from the /authorize step */
  code: z.string().min(1, "code is required"),
  /** Must exactly match the redirect URI used when obtaining the code */
  redirect_uri: z.string().url(),
  /** Public client identifier; UUID in your example */
  client_id: z.string().uuid(),
  /** PKCE verifier bound to the code */
  code_verifier: z.string().regex(pkceVerifierRegex, "code_verifier must be 43–128 chars of A–Z, a–z, 0–9, '-', '.', '_' or '~'",),
  /** Optional resource/audience (used by some providers like AAD v1) */
  resource: z.string().url().describe("FrontMcp scope url"),
});
const anonymousGrant = z.object({
  grant_type: z.literal("anonymous"),
  /** Public client identifier; UUID in your example */
  client_id: z.string().uuid(),
  /** Target resource/audience is required for this custom flow */
  resource: z.string().url(),
});

const stateSchema = z.object({
  body: z.discriminatedUnion('grant_type', [anonymousGrant, authorizationCodeGrant]),
  isDefaultAuthProvider: z.boolean().describe("If FrontMcp initialized without auth options"),
});

const outputSchema = HttpJsonSchema;


const plan = {
  pre: [
    'parseInput',
    'validateInput',
  ],
  execute: [
    'generateJWT',
    'buildAuthorizeOutput'
  ],
  post: [
    'validateOutput',
  ],
};


declare global {
  export interface ExtendFlows {
    'oauth:token': FlowRunOptions<
      OauthTokenFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'oauth:token' as const;
const Stage = StageHookOf(name);

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'public',
  middleware: {
    method: 'POST',
    path: '/oauth/token',
  },
})
export default class OauthTokenFlow extends FlowBase<typeof name> {

  @Stage('parseInput')
  async parseInput() {
    const {metadata} = this.scope;
    const {request} = this.rawInput;


    if (!metadata.auth) {
      const isDefaultAuthProvider = true
      this.state.set(stateSchema.parse({
        isDefaultAuthProvider, //
        body: request.body,
      }))
    } else {
      // TODO:
      //  support local/remote proxy auth provider
      //  the call next only if scope isn't orchestrated
      this.next()
    }
  }

  @Stage('validateInput')
  async validateInput() {

    const localAuth = this.scope.auth as LocalPrimaryAuth;
    const access_token = await localAuth.signAnonymousJwt()
    const refresh_token = randomUUID()
    this.respond(httpRespond.json({
      access_token,
      token_type: 'Bearer',
      expires_in: 86500,
      refresh_token,
    }))

    // TBD
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