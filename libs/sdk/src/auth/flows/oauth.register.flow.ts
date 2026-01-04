/**
 * Dynamic Client Registration — POST /oauth/register
 *
 * Who calls: Developers/automation.
 *
 * Purpose: Let clients register programmatically (redirect URIs, grant types, etc.).
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
import { randomUUID, randomBytes, base64urlEncode } from '@frontmcp/utils';

/** Simple in-memory registry (dev only) */
type RegisteredClient = {
  client_id: string;
  client_secret?: string;
  token_endpoint_auth_method:
    | 'none'
    | 'client_secret_basic'
    | 'client_secret_post'
    | 'private_key_jwt'
    | 'tls_client_auth';
  grant_types: string[];
  response_types: string[];
  redirect_uris: string[];
  client_name?: string;
  scope?: string;
  created_at: number; // seconds since epoch
  dev: boolean;
};

const CLIENTS = new Map<string, RegisteredClient>();

/** Optional: export getters so other flows can validate client_id */
export const DevClientRegistry = {
  get(client_id: string) {
    return CLIENTS.get(client_id);
  },
  has(client_id: string) {
    return CLIENTS.has(client_id);
  },
};

const inputSchema = httpInputSchema;
const outputSchema = HttpJsonSchema;

const registrationRequestSchema = z
  .object({
    // RFC 7591-ish minimal set
    redirect_uris: z.array(z.string().url()).min(1, 'At least one redirect_uri is required'),
    token_endpoint_auth_method: z
      .enum(['none', 'client_secret_basic', 'client_secret_post', 'private_key_jwt', 'tls_client_auth'])
      .default('none'),
    grant_types: z
      .array(z.enum(['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:device_code']))
      .default(['authorization_code']),
    response_types: z.array(z.enum(['code'])).default(['code']),
    client_name: z.string().optional(),
    scope: z.string().optional(),
  })
  .passthrough();

const stateSchema = z.object({
  body: registrationRequestSchema,
  isDev: z.boolean(),
});

const plan = {
  pre: ['parseInput', 'validateInput'],
  execute: ['registerClient', 'respondRegistration'],
  post: ['validateOutput'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'oauth:register': FlowRunOptions<
      OauthRegisterFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'oauth:register' as const;
const Stage = StageHookOf(name);

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'public',
  middleware: {
    method: 'POST',
    path: '/oauth/register',
  },
})
export default class OauthRegisterFlow extends FlowBase<typeof name> {
  private registered?: RegisteredClient;

  @Stage('parseInput')
  async parseInput() {
    // Dev-only guard: hide the endpoint in production
    const isDev = process.env['NODE_ENV'] !== 'production';

    const { request } = this.rawInput;
    const parsed = registrationRequestSchema.parse(request.body || {});
    this.state.set({
      body: parsed,
      isDev,
    });
  }

  @Stage('validateInput')
  async validateInput() {
    if (!this.state.isDev) {
      // Behave like the endpoint doesn't exist in prod
      this.next();
      return;
    }

    // Minimal sanity checks for common mistakes in dev
    const { redirect_uris, token_endpoint_auth_method, grant_types, response_types } = this.state.required.body;

    // Keep only supported combinations for the dummy server
    if (!response_types.includes('code')) {
      this.respond(
        httpRespond.json(
          {
            error: 'invalid_client_metadata',
            error_description: 'Only response_types=["code"] is supported in dev.',
          },
          { status: 400 },
        ),
      );
      return;
    }

    if (!grant_types.includes('authorization_code')) {
      this.respond(
        httpRespond.json(
          {
            error: 'invalid_client_metadata',
            error_description: 'grant_types must include "authorization_code" in dev.',
          },
          { status: 400 },
        ),
      );
      return;
    }

    // Warn (soft) if confidential but no TLS/jwt (still allowed for local only)
    if (
      token_endpoint_auth_method !== 'none' &&
      token_endpoint_auth_method !== 'client_secret_post' &&
      token_endpoint_auth_method !== 'client_secret_basic'
    ) {
      this.respond(
        httpRespond.json(
          {
            error: 'invalid_client_metadata',
            error_description: 'This dev server only supports "none", "client_secret_post", or "client_secret_basic".',
          },
          { status: 400 },
        ),
      );
      return;
    }

    // Ensure localhost/https-ish redirects for dev
    const bad = redirect_uris.find((u) => !/^https?:\/\/(localhost|\d+\.\d+\.\d+\.\d+|127\.0\.0\.1)/.test(u));
    if (bad) {
      this.respond(
        httpRespond.json(
          {
            error: 'invalid_redirect_uri',
            error_description: `Dev registration allows only localhost-style redirect_uris; got ${bad}`,
          },
          { status: 400 },
        ),
      );
      return;
    }
  }

  @Stage('registerClient')
  async registerClient() {
    const now = Math.floor(Date.now() / 1000);
    const { token_endpoint_auth_method, grant_types, response_types, redirect_uris, client_name, scope } =
      this.state.required.body;

    const client_id = randomUUID();
    let client_secret: string | undefined;

    if (token_endpoint_auth_method === 'client_secret_post' || token_endpoint_auth_method === 'client_secret_basic') {
      client_secret = base64urlEncode(randomBytes(24)); // short-lived dev secret
    }

    this.registered = {
      client_id,
      client_secret,
      token_endpoint_auth_method,
      grant_types,
      response_types,
      redirect_uris,
      client_name,
      scope,
      created_at: now,
      dev: true,
    };

    CLIENTS.set(client_id, this.registered);
  }

  @Stage('respondRegistration')
  async respondRegistration() {
    const c = this.registered!;
    // Minimal RFC 7591-ish response
    // (intentionally omitting registration_access_token/registration_client_uri for simplicity in dev)
    this.respond(
      httpRespond.json({
        client_id: c.client_id,
        ...(c.client_secret ? { client_secret: c.client_secret } : {}),
        client_id_issued_at: c.created_at,
        client_secret_expires_at: c.client_secret ? 0 : 0, // 0 = does not expire (dev)
        token_endpoint_auth_method: c.token_endpoint_auth_method,
        grant_types: c.grant_types,
        response_types: c.response_types,
        redirect_uris: c.redirect_uris,
        ...(c.client_name ? { client_name: c.client_name } : {}),
        ...(c.scope ? { scope: c.scope } : {}),
      }),
    );
  }

  @Stage('validateOutput')
  async validateOutput() {
    // no-op; httpRespond.json enforces shape
  }
}
