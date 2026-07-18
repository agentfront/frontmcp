/**
 * Dynamic Client Registration — POST /oauth/register
 *
 * Who calls: Developers/automation.
 *
 * Purpose: Let clients register programmatically (redirect URIs, grant types, etc.).
 *
 * Control surface (#462): the LOCAL Authorization Server's DCR is governed by
 * the declarative `auth.dcr` block. When `dcr` is omitted the historical
 * behavior is preserved exactly — registration is enabled in development and
 * disabled in production (via `isProduction()`), with no allowlist and no
 * initial access token. When configured, this flow enforces:
 *   - `dcr.enabled === false` → 404 (behave as if the endpoint does not exist)
 *   - `dcr.initialAccessToken` → require `Authorization: Bearer <token>` (401)
 *   - `dcr.allowedClientIds` → registrations are pinned to an allowed id (400)
 *   - `dcr.allowedRedirectUris` → reject unlisted redirect_uris (400)
 * Registered clients are stored on the per-instance {@link DcrClientRegistry}
 * (LocalPrimaryAuth), so the authorize/token flows can validate them.
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

import { type RegisteredClient } from '@frontmcp/auth';
import { z } from '@frontmcp/lazy-zod';
import { base64urlEncode, randomBytes, randomUUID } from '@frontmcp/utils';

import {
  Flow,
  FlowBase,
  httpInputSchema,
  HttpJsonSchema,
  httpRespond,
  StageHookOf,
  type FlowPlan,
  type FlowRunOptions,
} from '../../common';
import { type LocalPrimaryAuth } from '../instances/instance.local-primary-auth';

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
  /** Whether DCR is active (explicit `dcr.enabled` or the dev/prod default). */
  dcrEnabled: z.boolean(),
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

/** Read the `Authorization: Bearer <token>` header, if present. */
function extractBearer(headers: Record<string, string> | undefined): string | undefined {
  const raw = headers?.['authorization'] ?? headers?.['Authorization'];
  if (typeof raw !== 'string') return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match ? match[1].trim() : undefined;
}

/**
 * Whether a redirect_uri targets the loopback interface (localhost, 127.0.0.0/8,
 * ::1) — the only hosts the default DCR guard accepts when no
 * `dcr.allowedRedirectUris` allowlist is configured.
 *
 * SECURITY: parses with `URL` and matches on the real `hostname`, replacing the
 * previous unanchored substring regex `^https?://(localhost|\d+\.\d+\.\d+\.\d+|127\.0\.0\.1)`
 * which accepted attacker hosts such as `http://localhost.evil.com/cb`,
 * `http://1.2.3.4.evil.com/cb`, and — via userinfo — `http://127.0.0.1@evil.com/cb`
 * (whose real host is `evil.com`). Any userinfo component is rejected outright.
 */
function isLoopbackRedirectUri(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  // Reject `user:pass@host` — the authority host is what actually gets contacted.
  if (url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '::1') return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const octets = m.slice(1).map((n) => Number(n));
    return octets.every((o) => o >= 0 && o <= 255) && octets[0] === 127;
  }
  return false;
}

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

  /** The local AS primary auth, which owns the DCR client registry (#462). */
  private get localAuth(): LocalPrimaryAuth {
    return this.scope.auth as LocalPrimaryAuth;
  }

  @Stage('parseInput')
  async parseInput() {
    // DCR activation: honor an explicit `dcr.enabled`, else the historical
    // dev/prod guard. Centralized on LocalPrimaryAuth so the register flow and
    // the AS-metadata flow agree.
    const dcrEnabled = this.localAuth.isDcrEnabled?.() ?? true;

    const { request } = this.rawInput;
    const parsed = registrationRequestSchema.parse(request.body || {});
    this.state.set({
      body: parsed,
      dcrEnabled,
    });
  }

  @Stage('validateInput')
  async validateInput() {
    const { request } = this.rawInput;
    const dcr = this.localAuth.getDcrConfig?.();
    const registry = this.localAuth.dcrClientRegistry;

    // (1) Disabled — behave like the endpoint does not exist.
    if (!this.state.dcrEnabled) {
      this.respond(
        httpRespond.json(
          {
            error: 'access_denied',
            error_description: 'Dynamic Client Registration is disabled.',
          },
          { status: 404 },
        ),
      );
      return;
    }

    // (2) Initial Access Token (RFC 7591 §3) — when configured, require a
    // matching Authorization: Bearer header.
    if (registry?.requiresInitialAccessToken?.()) {
      const presented = extractBearer(request.headers as Record<string, string> | undefined);
      if (!registry.verifyInitialAccessToken(presented)) {
        this.respond(
          httpRespond.json(
            {
              error: 'invalid_token',
              error_description: 'A valid initial access token is required to register a client.',
            },
            { status: 401 },
          ),
        );
        return;
      }
    }

    const { redirect_uris, token_endpoint_auth_method, grant_types, response_types } = this.state.required.body;

    // Keep only supported combinations for the local server.
    if (!response_types.includes('code')) {
      this.respond(
        httpRespond.json(
          {
            error: 'invalid_client_metadata',
            error_description: 'Only response_types=["code"] is supported.',
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
            error_description: 'grant_types must include "authorization_code".',
          },
          { status: 400 },
        ),
      );
      return;
    }

    // Confidential-client auth methods are limited to what the local AS supports.
    if (
      token_endpoint_auth_method !== 'none' &&
      token_endpoint_auth_method !== 'client_secret_post' &&
      token_endpoint_auth_method !== 'client_secret_basic'
    ) {
      this.respond(
        httpRespond.json(
          {
            error: 'invalid_client_metadata',
            error_description: 'This server only supports "none", "client_secret_post", or "client_secret_basic".',
          },
          { status: 400 },
        ),
      );
      return;
    }

    // (3) redirect_uri allowlist. When `dcr.allowedRedirectUris` is configured,
    // every requested redirect_uri must match it. Otherwise keep the historical
    // localhost-style guard so the default dev behavior is unchanged.
    if (registry?.hasRedirectAllowlist?.()) {
      const bad = redirect_uris.find((u) => !registry.isRedirectUriAllowed(u));
      if (bad) {
        this.respond(
          httpRespond.json(
            {
              error: 'invalid_redirect_uri',
              error_description: `redirect_uri "${bad}" is not in the configured allowlist.`,
            },
            { status: 400 },
          ),
        );
        return;
      }
    } else {
      const bad = redirect_uris.find((u) => !isLoopbackRedirectUri(u));
      if (bad) {
        this.respond(
          httpRespond.json(
            {
              error: 'invalid_redirect_uri',
              error_description: `Registration allows only loopback redirect_uris (localhost, 127.0.0.0/8, ::1) without an allowlist; got ${bad}`,
            },
            { status: 400 },
          ),
        );
        return;
      }
    }

    // (4) client_id allowlist sanity. DCR mints a server-side client_id, so we
    // cannot honor a client-supplied id, but if an allowlist is configured a
    // freshly-minted random id can never satisfy it — surface that as a clear
    // configuration error rather than issuing an unusable client.
    if (registry?.hasClientIdAllowlist?.() && !dcr?.clients?.length) {
      this.respond(
        httpRespond.json(
          {
            error: 'access_denied',
            error_description:
              'Client-id allowlist is enforced; register clients declaratively via auth.dcr.clients instead of DCR.',
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
      client_secret = base64urlEncode(randomBytes(24));
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

    // Reject when the dynamic-client capacity is reached, rather than evicting
    // an existing registration. Existing clients (incl. confidential ones) are
    // preserved; the caller should retry later.
    const accepted = this.localAuth.dcrClientRegistry.register(this.registered);
    if (!accepted) {
      this.scopeLogger.warn('OAuth register: dynamic client capacity reached — rejecting registration');
      this.respond(
        httpRespond.json(
          {
            error: 'temporarily_unavailable',
            error_description: 'Client registration capacity reached; please try again later.',
          },
          { status: 503 },
        ),
      );
      return;
    }
  }

  @Stage('respondRegistration')
  async respondRegistration() {
    const c = this.registered;
    if (!c) {
      this.respond(
        httpRespond.json({ error: 'server_error', error_description: 'Client registration failed.' }, { status: 500 }),
      );
      return;
    }
    // Minimal RFC 7591-ish response
    // (intentionally omitting registration_access_token/registration_client_uri for simplicity)
    this.respond(
      httpRespond.json(
        {
          client_id: c.client_id,
          ...(c.client_secret ? { client_secret: c.client_secret } : {}),
          client_id_issued_at: c.created_at,
          client_secret_expires_at: 0, // 0 = does not expire
          token_endpoint_auth_method: c.token_endpoint_auth_method,
          grant_types: c.grant_types,
          response_types: c.response_types,
          redirect_uris: c.redirect_uris,
          ...(c.client_name ? { client_name: c.client_name } : {}),
          ...(c.scope ? { scope: c.scope } : {}),
        },
        { status: 201 },
      ),
    );
  }

  @Stage('validateOutput')
  async validateOutput() {
    // no-op; httpRespond.json enforces shape
  }
}
