// auth/flows/well-known.prm.flow.ts
import 'reflect-metadata';

import { resourceScopesFor, type ResourceScopeOptions } from '@frontmcp/auth';
import { z } from '@frontmcp/lazy-zod';

import {
  computeResource,
  enforceIpFilter,
  Flow,
  FlowBase,
  getRequestBaseUrl,
  httpInputSchema,
  HttpJsonSchema,
  makeWellKnownPaths,
  StageHookOf,
  type FlowPlan,
  type FlowRunOptions,
  type ScopeEntry,
  type ServerRequest,
} from '../../common';
import { FlowInputMissingError } from '../../errors/sdk.errors';

const inputSchema = httpInputSchema;

const stateSchema = z.object({
  resource: z.string().min(1),
  baseUrl: z.string().min(1),
  // The authorization server to name: the issuer this server names for the request (#629).
  authorizationServer: z.string().min(1).optional(),
  scopesSupported: z.array(z.string()),
  isOrchestrated: z.boolean(),
});

const outputSchema = HttpJsonSchema.extend({
  body: z
    .object({
      resource: z.string().min(1),
      authorization_servers: z.array(z.string().min(1)).min(1),
      scopes_supported: z.array(z.string()).optional(),
      bearer_methods_supported: z.array(z.string()).default(['header']),
    })
    .passthrough(),
});

const plan = {
  pre: ['checkIpFilter', 'parseInput'],
  execute: ['collectData'],
  post: ['validateOutput'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'well-known.oauth-protected-resource': FlowRunOptions<
      WellKnownPrmFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'well-known.oauth-protected-resource' as const;
const Stage = StageHookOf(name);

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'public',
  middleware: {
    method: 'GET',
  },
})
export default class WellKnownPrmFlow extends FlowBase<typeof name> {
  static canActivate(request: ServerRequest, scope: ScopeEntry) {
    return makeWellKnownPaths('oauth-protected-resource', scope.entryPath, scope.routeBase).has(request.path);
  }

  @Stage('checkIpFilter')
  async checkIpFilter() {
    enforceIpFilter(this.scope, this.tryGetContext()?.metadata.clientIp);
  }

  @Stage('parseInput')
  async parseInput() {
    const { request } = this.rawInput;
    const scope = this.scope;
    if (!request) throw new FlowInputMissingError('request', 'well-known:prm');

    const resource = computeResource(request, scope.entryPath, scope.routeBase);
    const baseUrl = getRequestBaseUrl(request, scope.entryPath);
    // A server that issues its own tokens names the issuer it names everywhere else for this
    // request (`LocalPrimaryAuth.issuerFor`, #629): its authorization server metadata, the RFC 9207
    // `iss` of its authorization responses and its tokens' `iss` all say the same.
    const authorizationServer = (
      scope.auth as { issuerFor?: (request: ServerRequest) => string } | undefined
    )?.issuerFor?.(request);
    // Advertise the scopes a client can actually be given here, by mode (#262, #629): `allowedScopes`
    // in local and remote mode, `anonymousScopes` in public mode, the static credential's `scopes`,
    // transparent mode's `requiredScopes` and upstream `scopes`.
    // Outside local and remote mode, the scopes entries' `authProviders` declare are advertised too, so
    // clients know to request them.
    const authOptions = (scope.auth?.options ?? scope.metadata.auth) as ResourceScopeOptions | undefined;
    const granted = resourceScopesFor(authOptions);
    const orchestrated = authOptions?.mode === 'local' || authOptions?.mode === 'remote';
    const scopesSupported = orchestrated ? granted : [...new Set([...granted, ...scope.getAllSupportedScopes()])];
    this.state.set(
      stateSchema.parse({
        resource,
        baseUrl,
        authorizationServer,
        scopesSupported,
        isOrchestrated: false, //scope.orchestrated,// TODO: fix
      }),
    );
  }

  @Stage('collectData') async collectData() {
    const { resource, baseUrl, scopesSupported, isOrchestrated } = this.state.required;
    const { authorizationServer } = this.state;
    // RFC 9728 §2: `scopes_supported` is optional; a server that names no scopes leaves it out.
    const scopes = scopesSupported.length > 0 ? { scopes_supported: scopesSupported } : {};

    if (isOrchestrated) {
      this.respond({
        kind: 'json',
        contentType: 'application/json; charset=utf-8',
        status: 200,
        // Never cache: the body embeds the request-derived origin, so a shared
        // cache keyed only on (Host, path) could otherwise serve a poisoned
        // `authorization_servers` value to another client (OAuth mix-up).
        headers: { 'cache-control': 'no-store' },
        body: {
          resource,
          authorization_servers: [authorizationServer ?? baseUrl],
          ...scopes,
          bearer_methods_supported: ['header'],
        },
      });
      return;
    }
    // Derive the authorization server from the request base (Host/X-Forwarded-*)
    // rather than the static boot-time issuer (#467). Behind a proxy or tunnel
    // the boot-time issuer (e.g. http://localhost:PORT) does not match the URL
    // the client actually reached, which breaks discovery. The request-derived
    // base mirrors the resource URL the same flow already advertises.
    // Transparent scope
    this.respond({
      kind: 'json',
      status: 200,
      contentType: 'application/json; charset=utf-8',
      headers: { 'cache-control': 'no-store' },
      body: {
        resource,
        authorization_servers: [authorizationServer ?? baseUrl],
        ...scopes,
        bearer_methods_supported: ['header'],
      },
    });
  }
}
