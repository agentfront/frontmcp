// auth/flows/well-known.prm.flow.ts
import 'reflect-metadata';
import { z } from 'zod';
import {
  Flow,
  FlowBase,
  FlowRunOptions,
  httpInputSchema,
  HttpJsonSchema,
  ScopeEntry,
  ServerRequest,
  StageHookOf,
} from '@frontmcp/sdk';
import { computeResource, getRequestBaseUrl, makeWellKnownPaths } from '../path.utils';

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
};

declare global {
  export interface ExtendFlows {
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
    if (!request) throw new Error('Request is undefined');

    const resource = computeResource(request, scope.entryPath, scope.routeBase);
    const baseUrl = getRequestBaseUrl(request, scope.entryPath);
    this.state.set(stateSchema.parse({
      resource,
      baseUrl,
      scopesSupported: ['openid', 'profile', 'email'],
      isOrchestrated: false,//scope.orchestrated,// TODO: fix
    }));
  }

  @Stage('collectData') async collectData() {
    const { resource, baseUrl, scopesSupported, isOrchestrated } = this.state.required;

    if (isOrchestrated) {
      this.respond({
        kind: 'json',
        contentType: 'application/json; charset=utf-8',
        status: 200,
        body: {
          resource,
          authorization_servers: [baseUrl],
          scopes_supported: scopesSupported,
          bearer_methods_supported: ['header'],
        },
      });
      return;
    }
    const issuer = this.scope.auth.issuer;
    // Transparent scope
    this.respond({
      kind: 'json',
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: {
        resource,
        authorization_servers: [issuer],
        scopes_supported: scopesSupported,
        bearer_methods_supported: ['header'],
      },
    });
  }
}
