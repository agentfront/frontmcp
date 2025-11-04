// auth/flows/well-known.jwks.flow.ts
import {
  Flow, FlowBase,
  FlowRunOptions, httpInputSchema, HttpJsonSchema, HttpRedirectSchema, httpRespond, HttpTextSchema,
  RemoteAuthOptions, ScopeEntry, ServerRequest, StageHookOf,
} from '@frontmcp/sdk';
import 'reflect-metadata';
import { z } from 'zod';
import { makeWellKnownPaths } from '../path.utils';
import { JwksService } from '../jwks';


const inputSchema = httpInputSchema;

const stateSchema = z.object({
  isOrchestrated: z.boolean(),
});

const outputSchema = z.union([HttpJsonSchema, HttpTextSchema, HttpRedirectSchema]);

const plan = {
  pre: ['parseInput', 'validateInput'],
  execute: ['collectData'],
};

declare global {
  export interface ExtendFlows {
    'well-known.jwks': FlowRunOptions<
      WellKnownJwksFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'well-known.jwks' as const;
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
export default class WellKnownJwksFlow extends FlowBase<typeof name> {
  static canActivate(request: ServerRequest, scope: ScopeEntry) {
    return makeWellKnownPaths('jwks.json', scope.entryPath, scope.routeBase).has(request.path);
  }

  @Stage('parseInput')
  async parseInput() {
    this.state.set({
      isOrchestrated: false, // scope.orchestrated, TODO: fix
    });
  }

  @Stage('collectData')
  async collectData() {
    const { isOrchestrated } = this.state.required;
    const jwksSvc = this.get(JwksService);

    // Orchestrated gateway → serve own JWKS
    if (isOrchestrated) {
      const keysDoc = jwksSvc.getPublicJwks();
      if (!keysDoc?.keys || !Array.isArray(keysDoc.keys)) {
        throw new Error('orchestrator jwks not available');
      }
      this.respond(httpRespond.json(keysDoc));
      return;
    }

    const primary = this.scope.auth.options as RemoteAuthOptions;
    if (primary) {
      if (primary.jwks && primary.jwks.keys.length) {
        this.respond(httpRespond.json(primary.jwks));
      } else {
        const location = primary.jwksUri ?? `${primary.baseUrl}/.well-known/jwks.json`;
        this.respond(httpRespond.redirect(location));
      }
    } else {
      this.respond(httpRespond.notFound());
    }
  }
}
