// auth/flows/well-known.oauth-authorization-server.flow.ts
import 'reflect-metadata';

import { advertisedScopes, trimSlash } from '@frontmcp/auth';
import { z } from '@frontmcp/lazy-zod';
import { isProduction } from '@frontmcp/utils';

import {
  enforceGlobalRateLimit,
  enforceIpFilter,
  Flow,
  FlowBase,
  getRequestBaseUrl,
  httpInputSchema,
  HttpRedirectSchema,
  httpRespond,
  HttpTextSchema,
  isLocalMode,
  isOrchestratedMode,
  isTransparentMode,
  makeWellKnownPaths,
  StageHookOf,
  type FlowPlan,
  type FlowRunOptions,
  type ScopeEntry,
  type ServerRequest,
} from '../../common';
import { FlowInputMissingError } from '../../errors/sdk.errors';

/**
 * Resolve whether the local-AS Dynamic Client Registration endpoint is active
 * (#462), so AS metadata only advertises `registration_endpoint` when DCR is
 * actually mounted. Honors an explicit `auth.dcr.enabled`; otherwise falls back
 * to the historical guard (on in development, off in production). Only `local`
 * mode carries `dcr` — every other orchestrated mode keeps the dev/prod default.
 */
function resolveDcrEnabled(auth: unknown): boolean {
  if (auth && isLocalMode(auth as never)) {
    const dcr = (auth as { dcr?: { enabled?: boolean } }).dcr;
    if (dcr && typeof dcr.enabled === 'boolean') {
      return dcr.enabled;
    }
  }
  return !isProduction();
}

const inputSchema = httpInputSchema;

// ===== Result =====
const AuthServerMetadataSchema = z.object({
  kind: z.literal('json'),
  status: z.literal(200),
  contentType: z.literal('application/json; charset=utf-8'),
  // Response headers (e.g. `Cache-Control: no-store`). This flow uses a custom
  // output schema rather than `HttpJsonSchema`, so `headers` must be declared
  // explicitly for the renderer to emit it.
  headers: z.record(z.string(), z.string()).optional(),
  body: z
    .object({
      issuer: z.string().min(1),
      authorization_endpoint: z.string().min(1),
      token_endpoint: z.string().min(1),
      userinfo_endpoint: z.string().min(1).optional(),
      jwks_uri: z.string().min(1),
      registration_endpoint: z.string().min(1).optional(),
      token_endpoint_auth_methods_supported: z
        .array(z.enum(['client_secret_basic', 'client_secret_post', 'private_key_jwt']))
        .optional(),
      response_types_supported: z.array(z.enum(['code'])).default(['code']),
      grant_types_supported: z
        .array(z.enum(['authorization_code', 'refresh_token']))
        .default(['authorization_code', 'refresh_token']),
      scopes_supported: z.array(z.string()).default(['openid', 'profile', 'email']),
      code_challenge_methods_supported: z.array(z.enum(['S256'])).default(['S256']),
    })
    .passthrough(),
});

export const outputSchema = z.union([AuthServerMetadataSchema, HttpRedirectSchema, HttpTextSchema]);

export const wellKnownAsStateSchema = z.object({
  baseUrl: z.string().min(1), // baseUrl + entryPrefix (unsuffixed)
  // The issuer this server names in answer to the request (`LocalPrimaryAuth.issuerFor`, #629): the
  // one on its authorization responses and tokens. Without it, `baseUrl`.
  issuer: z.string().min(1).optional(),
  // Root origin (proto://host WITHOUT the entryPath prefix). The OAuth
  // endpoints (/oauth/authorize, /oauth/token, /oauth/register, …) are
  // registered at literal root paths by their flows, NOT under entryPath, so
  // they must be advertised relative to this root rather than `baseUrl`
  // (which carries the entryPath) — see #467.
  oauthBaseUrl: z.string().min(1),
  scopesSupported: z.array(z.string()).default(['openid', 'profile', 'email']),
  tokenEndpointAuthMethods: z
    .array(z.enum(['client_secret_basic', 'client_secret_post', 'private_key_jwt']))
    .default(['client_secret_basic', 'client_secret_post']),
  dcrEnabled: z.boolean().default(true),
  isOrchestrated: z.boolean(),
  // CIMD support
  cimdEnabled: z.boolean().default(true),
});

const wellKnownAsPlan = {
  pre: ['checkIpFilter', 'acquireQuota', 'parseInput'],
  execute: ['collectData'],
} as const satisfies FlowPlan<string>;

type WellKnownAsPlan = typeof wellKnownAsPlan;
type WellKnownAsFlowOptions = FlowRunOptions<
  WellKnownAsFlow,
  WellKnownAsPlan,
  typeof inputSchema,
  typeof outputSchema,
  typeof wellKnownAsStateSchema
>;

declare global {
  interface ExtendFlows {
    'well-known.oauth-authorization-server': WellKnownAsFlowOptions;
  }
}

const name = 'well-known.oauth-authorization-server' as const;
const Stage = StageHookOf(name);

@Flow({
  name,
  plan: wellKnownAsPlan,
  inputSchema,
  outputSchema,
  access: 'public',
  middleware: {
    method: 'GET',
  },
})
export default class WellKnownAsFlow extends FlowBase<typeof name> {
  static canActivate(request: ServerRequest, scope: ScopeEntry) {
    return makeWellKnownPaths('oauth-authorization-server', scope.entryPath, scope.routeBase).has(request.path);
  }

  @Stage('checkIpFilter')
  async checkIpFilter() {
    enforceIpFilter(this.scope, this.tryGetContext()?.metadata.clientIp);
  }

  @Stage('acquireQuota')
  async acquireQuota() {
    await enforceGlobalRateLimit(this.scope, this.tryGetContext());
  }

  @Stage('parseInput')
  async parseInput() {
    const { request } = this.rawInput;
    if (!request) throw new FlowInputMissingError('request', 'well-known:oauth-authorization-server');

    const { metadata } = this.scope;
    const baseUrl = getRequestBaseUrl(request, this.scope.entryPath);
    // The issuer every entry point names for this request (#629): the RFC 9207 `iss` of the
    // authorization responses and the `iss` of the tokens have to match what discovery says.
    const issuer = (this.scope.auth as { issuerFor?: (request: ServerRequest) => string } | undefined)?.issuerFor?.(
      request,
    );
    // Root origin (no entryPath) — OAuth endpoints are mounted at root.
    const oauthBaseUrl = getRequestBaseUrl(request);

    // Check if CIMD is enabled (default true if auth is orchestrated)
    let cimdEnabled = true;
    if (metadata.auth && isOrchestratedMode(metadata.auth)) {
      cimdEnabled = metadata.auth.cimd?.enabled ?? true;
    }

    this.state.set(
      wellKnownAsStateSchema.parse({
        baseUrl,
        issuer,
        oauthBaseUrl,
        // The scopes this server grants (`allowedScopes`, #262): the literal
        // entries; a `*` glob names no scope a client could ask for.
        scopesSupported:
          metadata.auth && isOrchestratedMode(metadata.auth) ? advertisedScopes(metadata.auth.allowedScopes) : [],
        tokenEndpointAuthMethods: [],
        // #462 — advertise registration_endpoint only when local-AS DCR is
        // actually active (explicit auth.dcr.enabled, else dev/prod default).
        dcrEnabled: resolveDcrEnabled(metadata.auth),
        isOrchestrated: metadata.auth ? isOrchestratedMode(metadata.auth) : false,
        cimdEnabled,
      }),
    );
  }

  @Stage('collectData')
  async collectData() {
    const { issuer } = this.state;
    const {
      baseUrl,
      oauthBaseUrl,
      scopesSupported,
      tokenEndpointAuthMethods,
      dcrEnabled,
      isOrchestrated,
      cimdEnabled,
    } = this.state.required;
    // Orchestrated => gateway is the AS
    if (isOrchestrated) {
      const baseIssuer = issuer ?? baseUrl;
      // OAuth endpoints live at the ROOT origin (oauthBaseUrl), not under the
      // entryPath-carrying issuer base — their flows register literal
      // `/oauth/*` paths at root (#467). The issuer + jwks_uri stay on
      // baseUrl: jwks.json is matched under the entryPath variant too.
      this.respond({
        kind: 'json',
        contentType: 'application/json; charset=utf-8',
        status: 200,
        // Never cache: the advertised endpoints are derived from the request
        // origin, so a shared cache could serve a poisoned authorization/token
        // endpoint to another client (OAuth mix-up).
        headers: { 'cache-control': 'no-store' },
        body: {
          issuer: baseIssuer,
          authorization_endpoint: `${oauthBaseUrl}/oauth/authorize`,
          token_endpoint: `${oauthBaseUrl}/oauth/token`,
          userinfo_endpoint: `${oauthBaseUrl}/oauth/userinfo`,
          jwks_uri: `${baseIssuer}/.well-known/jwks.json`,
          // #462 — only advertise registration when DCR is active. When it is
          // disabled, omitting the endpoint signals "no DCR" to clients.
          // Dynamic Client Registration is DEPRECATED as of MCP 2026-07-28 in
          // favour of Client ID Metadata Documents (PR #2858). It stays
          // advertised for authorization servers and clients that have not
          // adopted CIMD yet; new clients should prefer CIMD.
          ...(dcrEnabled ? { registration_endpoint: `${oauthBaseUrl}/oauth/register` } : {}),
          token_endpoint_auth_methods_supported: tokenEndpointAuthMethods,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          scopes_supported: scopesSupported,
          code_challenge_methods_supported: ['S256'],
          // Every authorization response, error responses included, carries `iss` (RFC 9207 §2, §3).
          authorization_response_iss_parameter_supported: true,
          // CIMD support advertisement per draft-ietf-oauth-client-id-metadata-document-00
          client_id_metadata_document_supported: cimdEnabled,
        },
      });
      return;
    }
    // Only a transparent server has an authorization server, its provider's. A public or static server
    // has none to describe or point at.
    const authOptions = this.scope.auth?.options;
    if (!authOptions || !isTransparentMode(authOptions)) {
      this.respond(httpRespond.notFound());
      return;
    }
    this.respond(httpRespond.redirect(`${trimSlash(this.scope.auth.issuer)}/.well-known/oauth-authorization-server`));
  }
}
