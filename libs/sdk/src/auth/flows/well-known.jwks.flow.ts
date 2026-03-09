// auth/flows/well-known.jwks.flow.ts
import {
  Flow,
  FlowBase,
  FlowPlan,
  FlowRunOptions,
  httpInputSchema,
  HttpJsonSchema,
  HttpRedirectSchema,
  httpRespond,
  HttpTextSchema,
  ScopeEntry,
  ServerRequest,
  StageHookOf,
  isTransparentMode,
  makeWellKnownPaths,
} from '../../common';
import 'reflect-metadata';
import { z } from 'zod';
import { JwksService } from '@frontmcp/auth';
import { OrchestratorJwksNotAvailableError } from '../../errors/auth-internal.errors';

const inputSchema = httpInputSchema;

const stateSchema = z.object({
  isOrchestrated: z.boolean(),
});

const outputSchema = z.union([HttpJsonSchema, HttpTextSchema, HttpRedirectSchema]);

const plan = {
  pre: ['parseInput', 'validateInput'],
  execute: ['collectData'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
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
      const keysDoc = await jwksSvc.getPublicJwks();
      if (!keysDoc?.keys || !Array.isArray(keysDoc.keys)) {
        throw new OrchestratorJwksNotAvailableError();
      }
      this.respond(httpRespond.json(keysDoc));
      return;
    }

    const options = this.scope.auth.options;
    if (options && isTransparentMode(options)) {
      // Transparent mode - use remote provider's JWKS
      if (options.providerConfig?.jwks && options.providerConfig.jwks.keys.length) {
        this.respond(httpRespond.json(options.providerConfig.jwks));
      } else {
        const location = options.providerConfig?.jwksUri ?? `${options.provider}/.well-known/jwks.json`;
        this.respond(httpRespond.redirect(location));
      }
    } else {
      // Public or orchestrated mode - serve local JWKS
      const keysDoc = await jwksSvc.getPublicJwks();
      if (keysDoc?.keys && Array.isArray(keysDoc.keys)) {
        this.respond(httpRespond.json(keysDoc));
      } else {
        this.respond(httpRespond.notFound());
      }
    }
  }
}
