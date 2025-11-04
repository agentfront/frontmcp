// auth/flows/well-known.oauth-authorization-server.flow.ts
import 'reflect-metadata';
import { z } from 'zod';
import {
  HttpRedirectSchema,
  httpRespond,
  HttpTextSchema,
  Flow,
  FlowBase,
  FlowRunOptions,
  ScopeEntry,
  ServerRequest,
  StageHookOf, httpInputSchema,
} from '@frontmcp/sdk';
import { getRequestBaseUrl, makeWellKnownPaths } from '../path.utils';


const inputSchema = httpInputSchema;


// ===== Result =====
const AuthServerMetadataSchema = z.object({
  kind: z.literal('json'),
  status: z.literal(200),
  contentType: z.literal('application/json; charset=utf-8'),
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
  scopesSupported: z.array(z.string()).default(['openid', 'profile', 'email']),
  tokenEndpointAuthMethods: z
    .array(z.enum(['client_secret_basic', 'client_secret_post', 'private_key_jwt']))
    .default(['client_secret_basic', 'client_secret_post']),
  dcrEnabled: z.boolean().default(true),
  isOrchestrated: z.boolean(),
});


const wellKnownAsPlan = {
  pre: ['parseInput'],
  execute: ['collectData'],
};

type WellKnownAsPlan = typeof wellKnownAsPlan;
type WellKnownAsFlowOptions = FlowRunOptions<
  WellKnownAsFlow,
  WellKnownAsPlan,
  typeof inputSchema,
  typeof outputSchema,
  typeof wellKnownAsStateSchema
>


declare global {
  // noinspection JSUnusedGlobalSymbols
  export interface ExtendFlows {
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

  @Stage('parseInput')
  async parseInput() {
    const { request } = this.rawInput;
    if (!request) throw new Error('Request is undefined');

    const baseUrl = getRequestBaseUrl(request, this.scope.entryPath);
    this.state.set(wellKnownAsStateSchema.parse({
      baseUrl,
      scopesSupported: [],
      tokenEndpointAuthMethods: [],
      dcrEnabled: false, //scope.oauth.dcrEnabled,
      isOrchestrated: false, // scope.orchestrated,
    }));
  }

  @Stage('collectData')
  async collectData() {
    const { baseUrl, scopesSupported, tokenEndpointAuthMethods, dcrEnabled, isOrchestrated } = this.state.required;
    // Orchestrated => gateway is the AS
    if (isOrchestrated) {
      const baseIssuer = `${baseUrl}`;
      this.respond({
        kind: 'json',
        contentType: 'application/json; charset=utf-8',
        status: 200,
        body: {
          issuer: baseIssuer,
          authorization_endpoint: `${baseIssuer}/oauth/authorize`,
          token_endpoint: `${baseIssuer}/oauth/token`,
          userinfo_endpoint: `${baseIssuer}/oauth/userinfo`,
          jwks_uri: `${baseIssuer}/.well-known/jwks.json`,
          registration_endpoint: dcrEnabled ? `${baseIssuer}/oauth/dcr/register` : undefined,
          token_endpoint_auth_methods_supported: tokenEndpointAuthMethods,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          scopes_supported: scopesSupported,
          code_challenge_methods_supported: ['S256'],
        },
      });
      return;
    }
    const primary = this.scope.auth;
    this.respond(httpRespond.redirect(`${primary.issuer}/.well-known/oauth-authorization-server`));
  }
}
