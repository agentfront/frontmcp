/**
 * Well-known discovery flow tests (#467)
 *
 * (a) PRM (`/.well-known/oauth-protected-resource`) must advertise an
 *     `authorization_servers` entry derived from the REQUEST base (Host /
 *     X-Forwarded-*), not the static boot-time issuer — otherwise the AS URL
 *     is wrong behind a proxy/tunnel.
 * (c) AS metadata (`/.well-known/oauth-authorization-server`) must advertise
 *     the `/oauth/*` endpoints at the ROOT origin (no entryPath prefix),
 *     because those routes are mounted at literal root paths — while the
 *     issuer/jwks_uri stay on the entryPath-carrying base.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { createMockHttpRequest, createMockScopeEntry } from '../../../__test-utils__';
import { httpInputSchema, HttpJsonSchema, type FlowMetadata } from '../../../common';
import WellKnownAsFlow, { wellKnownAsStateSchema } from '../well-known.oauth-authorization-server.flow';
import WellKnownPrmFlow from '../well-known.prm.flow';

/** Run a single async stage and capture a `respond(...)` FlowControl output. */
async function runStageCaptureRespond(flow: any, stages: string[]): Promise<any> {
  let output: any;
  for (const stage of stages) {
    try {
      await flow[stage]();
    } catch (e: any) {
      // FlowControl 'respond' carries `output`; re-throw anything else.
      if (e && typeof e === 'object' && 'type' in e && e.type === 'respond') {
        output = e.output;
        break;
      }
      if (e && typeof e === 'object' && 'output' in e) {
        output = e.output;
        break;
      }
      throw e;
    }
  }
  return output;
}

describe('Well-known PRM flow — authorization_servers host-derivation (#467a)', () => {
  function createPrmMetadata(): FlowMetadata<'well-known.oauth-protected-resource'> {
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
    return {
      name: 'well-known.oauth-protected-resource',
      plan: { pre: ['parseInput'], execute: ['collectData'], post: ['validateOutput'] },
      inputSchema: httpInputSchema,
      outputSchema,
      access: 'public',
      middleware: { method: 'GET' },
    } as FlowMetadata<'well-known.oauth-protected-resource'>;
  }

  it('uses the request Host (not the static issuer) for authorization_servers', async () => {
    const scope = createMockScopeEntry({ auth: { mode: 'local' } as any });
    // Static boot-time issuer points at localhost; the request arrives via a tunnel.
    (scope.auth as any).issuer = 'http://localhost:3001';
    (scope as any).getAllSupportedScopes = () => ['openid'];

    const input = createMockHttpRequest({
      method: 'GET',
      path: '/.well-known/oauth-protected-resource',
      headers: { host: 'mcp.example.com' },
    });

    const flow = new WellKnownPrmFlow(createPrmMetadata(), input as any, scope, jest.fn(), new Map());
    const output = await runStageCaptureRespond(flow, ['parseInput', 'collectData']);

    expect(output?.kind).toBe('json');
    // The AS URL must reflect the request host, NOT localhost:3001.
    expect(output.body.authorization_servers).toEqual(['http://mcp.example.com']);
    expect(output.body.authorization_servers[0]).not.toContain('localhost');
  });

  it('honors X-Forwarded-Host/Proto for authorization_servers', async () => {
    const scope = createMockScopeEntry({ auth: { mode: 'local' } as any });
    (scope.auth as any).issuer = 'http://localhost:3001';
    (scope as any).getAllSupportedScopes = () => ['openid'];

    const input = createMockHttpRequest({
      method: 'GET',
      path: '/.well-known/oauth-protected-resource',
      headers: { host: 'internal:3001', 'x-forwarded-host': 'public.example.com', 'x-forwarded-proto': 'https' },
    });

    const flow = new WellKnownPrmFlow(createPrmMetadata(), input as any, scope, jest.fn(), new Map());
    const output = await runStageCaptureRespond(flow, ['parseInput', 'collectData']);

    expect(output.body.authorization_servers).toEqual(['https://public.example.com']);
  });
});

describe('Well-known AS metadata — oauth endpoints at root (#467c)', () => {
  function createAsMetadata(): FlowMetadata<'well-known.oauth-authorization-server'> {
    return {
      name: 'well-known.oauth-authorization-server',
      plan: { pre: ['parseInput'], execute: ['collectData'] },
      inputSchema: httpInputSchema,
      // outputSchema is a union in the source; a permissive passthrough is fine for the stage test.
      outputSchema: z.any(),
      access: 'public',
      middleware: { method: 'GET' },
    } as unknown as FlowMetadata<'well-known.oauth-authorization-server'>;
  }

  it('advertises /oauth/* at the ROOT origin even when entryPath is set (orchestrated)', async () => {
    const scope = createMockScopeEntry({ auth: { mode: 'local', cimd: { enabled: true } } as any });
    // entryPath set → baseUrl carries it, but /oauth/* routes live at root.
    (scope as any).entryPath = '/mcp';
    (scope as any).metadata = { ...(scope as any).metadata, auth: { mode: 'local', cimd: { enabled: true } } };

    const input = createMockHttpRequest({
      method: 'GET',
      path: '/mcp/.well-known/oauth-authorization-server',
      headers: { host: 'mcp.example.com' },
    });

    const flow = new WellKnownAsFlow(createAsMetadata(), input as any, scope, jest.fn(), new Map());
    const output = await runStageCaptureRespond(flow, ['parseInput', 'collectData']);

    expect(output?.kind).toBe('json');
    const body = output.body;
    // issuer keeps the entryPath base...
    expect(body.issuer).toBe('http://mcp.example.com/mcp');
    expect(body.jwks_uri).toBe('http://mcp.example.com/mcp/.well-known/jwks.json');
    // ...but the oauth endpoints are at ROOT (no /mcp prefix), matching the routes.
    expect(body.authorization_endpoint).toBe('http://mcp.example.com/oauth/authorize');
    expect(body.token_endpoint).toBe('http://mcp.example.com/oauth/token');
    expect(body.registration_endpoint).toBe('http://mcp.example.com/oauth/register');
    expect(body.token_endpoint).not.toContain('/mcp/oauth');
  });

  it('state schema requires oauthBaseUrl (root origin) distinct from baseUrl', () => {
    const parsed = wellKnownAsStateSchema.parse({
      baseUrl: 'http://host/mcp',
      oauthBaseUrl: 'http://host',
      isOrchestrated: true,
    });
    expect(parsed.oauthBaseUrl).toBe('http://host');
    expect(parsed.baseUrl).toBe('http://host/mcp');
  });

  // #462 — registration_endpoint is gated on DCR being active.
  it('omits registration_endpoint when auth.dcr.enabled === false', async () => {
    const auth = { mode: 'local', dcr: { enabled: false } } as never;
    const scope = createMockScopeEntry({ auth });
    (scope as { metadata: unknown }).metadata = { ...(scope as { metadata: object }).metadata, auth };

    const input = createMockHttpRequest({
      method: 'GET',
      path: '/.well-known/oauth-authorization-server',
      headers: { host: 'mcp.example.com' },
    });

    const flow = new WellKnownAsFlow(createAsMetadata(), input as never, scope, jest.fn(), new Map());
    const output = await runStageCaptureRespond(flow, ['parseInput', 'collectData']);

    expect(output?.kind).toBe('json');
    expect(output.body.authorization_endpoint).toBe('http://mcp.example.com/oauth/authorize');
    // DCR disabled → no registration_endpoint advertised.
    expect(output.body.registration_endpoint).toBeUndefined();
  });

  it('advertises registration_endpoint when auth.dcr.enabled === true', async () => {
    const auth = { mode: 'local', dcr: { enabled: true } } as never;
    const scope = createMockScopeEntry({ auth });
    (scope as { metadata: unknown }).metadata = { ...(scope as { metadata: object }).metadata, auth };

    const input = createMockHttpRequest({
      method: 'GET',
      path: '/.well-known/oauth-authorization-server',
      headers: { host: 'mcp.example.com' },
    });

    const flow = new WellKnownAsFlow(createAsMetadata(), input as never, scope, jest.fn(), new Map());
    const output = await runStageCaptureRespond(flow, ['parseInput', 'collectData']);

    expect(output.body.registration_endpoint).toBe('http://mcp.example.com/oauth/register');
  });
});
