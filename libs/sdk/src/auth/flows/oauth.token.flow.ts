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
 * OAuth 2.0 Device Authorization Grant ("device code flow")
 * Who does what (at a glance)
 *
 * Device/TV/CLI (no browser)
 * Calls POST /oauth/device_authorization, shows the user a code + URL, and polls POST /oauth/token.
 *
 * User (on phone/laptop browser)
 * Visits the given verification_uri and authenticates using your normal OAuth login (whatever you already have). No new UI required beyond two tiny endpoints.
 *
 * Auth Server (you)
 * Stores the device transaction and, after the user authenticates, marks it as approved so the device's /oauth/token polling succeeds.
 *
 * Endpoints you need (only two "new" ones)
 *
 * POST /oauth/device_authorization ✅ (device calls)
 *
 * POST /oauth/token with grant urn:ietf:params:oauth:grant-type:device_code ✅ (device polls)
 *
 * GET /activate ➜ "UI handler" (user lands here from verification_uri — this just redirects into your existing /oauth/authorize)
 *
 * GET /activate/callback ➜ "UI handler" (your existing flow returns here after the user logs in; you flip the device record to approved and show a basic "All set" page)
 *
 * That's it. No pages with complex consent screens are required; reuse your normal /oauth/authorize
 */

import {
  Flow,
  FlowBase,
  FlowPlan,
  FlowRunOptions,
  httpInputSchema,
  HttpJsonSchema,
  httpRespond,
  StageHookOf,
} from '../../common';
import { z } from 'zod';
import { randomUUID } from '@frontmcp/utils';
import { LocalPrimaryAuth } from '../instances/instance.local-primary-auth';

const inputSchema = httpInputSchema;

// RFC 7636 PKCE: code_verifier is 43–128 chars from ALPHA / DIGIT / "-" / "." / "_" / "~"
const pkceVerifierRegex = /^[A-Za-z0-9_.~-]{43,128}$/;

const authorizationCodeGrant = z.object({
  grant_type: z.literal('authorization_code'),
  /** Authorization code returned from the /authorize step */
  code: z.string().min(1, 'code is required'),
  /** Must exactly match the redirect URI used when obtaining the code */
  redirect_uri: z.string().url(),
  /** Public client identifier */
  client_id: z.string().min(1),
  /** PKCE verifier bound to the code */
  code_verifier: z
    .string()
    .regex(pkceVerifierRegex, "code_verifier must be 43–128 chars of A–Z, a–z, 0–9, '-', '.', '_' or '~'"),
});

const refreshTokenGrant = z.object({
  grant_type: z.literal('refresh_token'),
  /** The refresh token */
  refresh_token: z.string().min(1, 'refresh_token is required'),
  /** Public client identifier */
  client_id: z.string().min(1),
});

const anonymousGrant = z.object({
  grant_type: z.literal('anonymous'),
  /** Public client identifier */
  client_id: z.string().min(1),
  /** Target resource/audience is required for this custom flow */
  resource: z.string().url().optional(),
});

const tokenRequestSchema = z.discriminatedUnion('grant_type', [
  anonymousGrant,
  authorizationCodeGrant,
  refreshTokenGrant,
]);

type TokenRequest = z.infer<typeof tokenRequestSchema>;

const stateSchema = z.object({
  body: tokenRequestSchema.optional(),
  grantType: z.enum(['authorization_code', 'refresh_token', 'anonymous']).optional(),
  isDefaultAuthProvider: z.boolean().describe('If FrontMcp initialized without auth options'),
  isOrchestrated: z.boolean().describe('If auth mode is orchestrated'),
  // Token response data
  tokenResponse: z
    .object({
      access_token: z.string(),
      token_type: z.literal('Bearer'),
      expires_in: z.number(),
      refresh_token: z.string().optional(),
      scope: z.string().optional(),
    })
    .optional(),
  // Error data
  error: z.string().optional(),
  errorDescription: z.string().optional(),
});

const outputSchema = HttpJsonSchema;

const plan = {
  pre: ['parseInput', 'validateInput'],
  execute: ['handleAuthorizationCodeGrant', 'handleRefreshTokenGrant', 'handleAnonymousGrant', 'buildTokenResponse'],
  post: ['validateOutput'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
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
  private logger = this.scope.logger.child('OauthTokenFlow');

  @Stage('parseInput')
  async parseInput() {
    const { metadata } = this.scope;
    const { request } = this.rawInput;

    // Determine if we're using default (anonymous) auth or orchestrated
    const isDefaultAuthProvider = !metadata.auth;
    const isOrchestrated = !isDefaultAuthProvider;

    try {
      const body = tokenRequestSchema.parse(request.body);
      this.state.set({
        isDefaultAuthProvider,
        isOrchestrated,
        body,
        grantType: body.grant_type,
      });
    } catch (err) {
      this.logger.warn('Invalid token request body', err);
      this.state.set({
        isDefaultAuthProvider,
        isOrchestrated,
        error: 'invalid_request',
        errorDescription: 'Invalid request body',
      });
    }
  }

  @Stage('validateInput')
  async validateInput() {
    const { error, errorDescription } = this.state;

    if (error) {
      this.respond(
        httpRespond.json(
          {
            error,
            error_description: errorDescription,
          },
          { status: 400 },
        ),
      );
    }
  }

  @Stage('handleAuthorizationCodeGrant', {
    filter: ({ state }) => state.grantType === 'authorization_code',
  })
  async handleAuthorizationCodeGrant() {
    const { body, isDefaultAuthProvider } = this.state.required;

    if (body?.grant_type !== 'authorization_code') return;

    // For default auth provider with "anonymous" code, just issue anonymous tokens
    if (isDefaultAuthProvider && body.code === 'anonymous') {
      const localAuth = this.scope.auth as LocalPrimaryAuth;
      const accessToken = await localAuth.signAnonymousJwt();

      this.state.set('tokenResponse', {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 86400,
        refresh_token: randomUUID(),
      });
      return;
    }

    // Real authorization code exchange
    const localAuth = this.scope.auth as LocalPrimaryAuth;
    const result = await localAuth.exchangeCode(body.code, body.client_id, body.redirect_uri, body.code_verifier);

    if ('error' in result) {
      this.logger.warn(`Code exchange failed: ${result.error}`);
      this.respond(
        httpRespond.json(
          {
            error: result.error,
            error_description: result.error_description,
          },
          { status: 400 },
        ),
      );
      return;
    }

    this.state.set('tokenResponse', {
      access_token: result.access_token,
      token_type: result.token_type,
      expires_in: result.expires_in,
      refresh_token: result.refresh_token,
      scope: result.scope,
    });
  }

  @Stage('handleRefreshTokenGrant', {
    filter: ({ state }) => state.grantType === 'refresh_token',
  })
  async handleRefreshTokenGrant() {
    const { body, isDefaultAuthProvider } = this.state.required;

    if (body?.grant_type !== 'refresh_token') return;

    // For default auth provider, just issue new anonymous tokens
    if (isDefaultAuthProvider) {
      const localAuth = this.scope.auth as LocalPrimaryAuth;
      const accessToken = await localAuth.signAnonymousJwt();

      this.state.set('tokenResponse', {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 86400,
        refresh_token: randomUUID(),
      });
      return;
    }

    // Real refresh token exchange
    const localAuth = this.scope.auth as LocalPrimaryAuth;
    const result = await localAuth.refreshAccessToken(body.refresh_token, body.client_id);

    if ('error' in result) {
      this.logger.warn(`Refresh token failed: ${result.error}`);
      this.respond(
        httpRespond.json(
          {
            error: result.error,
            error_description: result.error_description,
          },
          { status: 400 },
        ),
      );
      return;
    }

    this.state.set('tokenResponse', {
      access_token: result.access_token,
      token_type: result.token_type,
      expires_in: result.expires_in,
      refresh_token: result.refresh_token,
      scope: result.scope,
    });
  }

  @Stage('handleAnonymousGrant', {
    filter: ({ state }) => state.grantType === 'anonymous',
  })
  async handleAnonymousGrant() {
    const localAuth = this.scope.auth as LocalPrimaryAuth;
    const accessToken = await localAuth.signAnonymousJwt();

    this.state.set('tokenResponse', {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 86400,
      refresh_token: randomUUID(),
    });
  }

  @Stage('buildTokenResponse')
  async buildTokenResponse() {
    const { tokenResponse } = this.state;

    if (!tokenResponse) {
      this.respond(
        httpRespond.json(
          {
            error: 'server_error',
            error_description: 'Failed to generate tokens',
          },
          { status: 500 },
        ),
      );
      return;
    }

    this.logger.info('Token response generated successfully');
    this.respond(httpRespond.json(tokenResponse));
  }

  @Stage('validateOutput')
  async validateOutput() {
    // Schema handles output validation
  }
}
