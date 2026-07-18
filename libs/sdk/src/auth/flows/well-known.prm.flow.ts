// auth/flows/well-known.prm.flow.ts
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import {
  computeResource,
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
  scopesSupported: z.array(z.string()).default(['openid', 'profile', 'email']),
  isOrchestrated: z.boolean(),
});

const outputSchema = HttpJsonSchema.extend({
  body: z
    .object({
      resource: z.string().min(1),
      authorization_servers: z.array(z.string().min(1)).min(1),
      scopes_supported: z.array(z.string()).default(['openid', 'profile', 'email']),
      bearer_methods_supported: z.array(z.string()).default(['header']),
    })
    .passthrough(),
});

const plan = {
  pre: ['parseInput'],
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

  @Stage('parseInput')
  async parseInput() {
    const { request } = this.rawInput;
    const scope = this.scope;
    if (!request) throw new FlowInputMissingError('request', 'well-known:prm');

    const resource = computeResource(request, scope.entryPath, scope.routeBase);
    const baseUrl = getRequestBaseUrl(request, scope.entryPath);
    this.state.set(
      stateSchema.parse({
        resource,
        baseUrl,
        scopesSupported: scope.getAllSupportedScopes(),
        isOrchestrated: false, //scope.orchestrated,// TODO: fix
      }),
    );
  }

  @Stage('collectData') async collectData() {
    const { resource, baseUrl, scopesSupported, isOrchestrated } = this.state.required;

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
          authorization_servers: [baseUrl],
          scopes_supported: scopesSupported,
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
        authorization_servers: [baseUrl],
        scopes_supported: scopesSupported,
        bearer_methods_supported: ['header'],
      },
    });
  }
}
