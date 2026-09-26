/** `throttle.ipFilter` runs as the first stage of every HTTP-facing flow, not only the MCP endpoint (GHSA-hwfp-xv2f-fr8g). */
import 'reflect-metadata';

import type { IpFilterConfig } from '@frontmcp/guard';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Skill, SkillContext, Tool, ToolContext, type FlowName } from '../../../common';
import { type FetchHandlerCtx, type WebFetchHandler } from '../../../transport/web-fetch-handler';
import { type Scope } from '../../scope.instance';

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

@Skill({ name: 'triage', description: 'Triage support tickets', instructions: 'Read tickets only.' })
class TriageSkill extends SkillContext {}

@App({ id: 'ip-filter-routes', name: 'ip-filter-routes', tools: [PingTool], skills: [TriageSkill] })
class RoutesApp {}

const DENIED_PEER: FetchHandlerCtx = { remoteAddr: { hostname: '203.0.113.9' } };
const ALLOWED_PEER: FetchHandlerCtx = { remoteAddr: { hostname: '198.51.100.7' } };

const HTTP_FLOWS: FlowName[] = [
  'http:request',
  'http:ip-filter',
  'well-known.oauth-protected-resource',
  'well-known.oauth-authorization-server',
  'well-known.jwks',
  'oauth:authorize',
  'oauth:token',
  'oauth:register',
  'oauth:userinfo',
  'oauth:callback',
  'oauth:connect',
  'oauth:provider-callback',
  'oauth:auth-ui-extra',
  'skills-http:llm-txt',
  'skills-http:llm-full-txt',
  'skills-http:api',
];

const HTTP_ROUTES: Array<{ method: 'GET' | 'POST'; path: string }> = [
  { method: 'GET', path: '/.well-known/oauth-protected-resource' },
  { method: 'GET', path: '/.well-known/oauth-authorization-server' },
  { method: 'GET', path: '/.well-known/jwks.json' },
  { method: 'GET', path: '/oauth/authorize' },
  { method: 'POST', path: '/oauth/token' },
  { method: 'POST', path: '/oauth/register' },
  { method: 'GET', path: '/oauth/userinfo' },
  { method: 'GET', path: '/oauth/callback' },
  { method: 'GET', path: '/oauth/connect' },
  { method: 'POST', path: '/oauth/ui/extra' },
  { method: 'GET', path: '/llm.txt' },
  { method: 'GET', path: '/llm_full.txt' },
  { method: 'GET', path: '/skills' },
];

async function serverWith(ipFilter: IpFilterConfig): Promise<TestFetchServer> {
  return createTestFetchServer({
    info: { name: 'ip-filter-routes', version: '1.0.0' },
    apps: [RoutesApp],
    skillsConfig: { enabled: true },
    throttle: { enabled: true, ipFilter },
  });
}

function send(
  server: TestFetchServer,
  route: { method: 'GET' | 'POST'; path: string },
  ctx?: FetchHandlerCtx,
): Promise<Response> {
  const body = route.method === 'POST' ? JSON.stringify({}) : undefined;
  const request = new Request(new URL(route.path, 'http://localhost'), {
    method: route.method,
    headers: { 'content-type': 'application/json' },
    body,
  });
  return server.handler(request, ctx);
}

function withCtx(handler: WebFetchHandler, ctx: FetchHandlerCtx | undefined): WebFetchHandler {
  return (request) => handler(request, ctx);
}

describe('ipFilter on every HTTP route (GHSA-hwfp-xv2f-fr8g)', () => {
  describe('a denyList rule', () => {
    let server: TestFetchServer;

    beforeAll(async () => {
      server = await serverWith({ denyList: ['203.0.113.0/24'] });
    });

    it('rejects the MCP endpoint with a JSON-RPC error', async () => {
      const response = await rpc20260728(withCtx(server.handler, DENIED_PEER), 'tools/call', {
        name: 'ping',
        arguments: {},
      });

      expect({ status: response.status, code: response.message.error?.code }).toEqual({ status: 403, code: -32001 });
    });

    it.each(HTTP_ROUTES)('rejects $method $path with 403', async (route) => {
      const response = await send(server, route, DENIED_PEER);

      expect({ status: response.status, body: await response.json() }).toEqual({
        status: 403,
        body: { error: 'forbidden', message: 'Client IP rejected by ipFilter' },
      });
    });

    it.each(HTTP_ROUTES)('serves $method $path to an address it does not list', async (route) => {
      const response = await send(server, route, ALLOWED_PEER);

      expect(response.status).not.toBe(403);
    });

    it('lets an address it does not list call a tool', async () => {
      const response = await rpc20260728(withCtx(server.handler, ALLOWED_PEER), 'tools/call', {
        name: 'ping',
        arguments: {},
      });

      expect(response.message.result?.['isError']).not.toBe(true);
    });

    it.each(['/healthz', '/readyz'])('exempts the %s probe', async (path) => {
      const response = await send(server, { method: 'GET', path }, DENIED_PEER);

      expect(response.status).toBe(200);
    });
  });

  describe("defaultAction 'deny' with no client IP", () => {
    let server: TestFetchServer;

    beforeAll(async () => {
      server = await serverWith({ allowList: ['198.51.100.0/24'], defaultAction: 'deny' });
    });

    it('rejects the MCP endpoint when the runtime reports no peer', async () => {
      const response = await rpc20260728(server.handler, 'tools/call', { name: 'ping', arguments: {} });

      expect({ status: response.status, code: response.message.error?.code }).toEqual({ status: 403, code: -32001 });
    });

    it('rejects a discovery route when the runtime reports no peer', async () => {
      const response = await send(server, { method: 'GET', path: '/.well-known/oauth-protected-resource' });

      expect(response.status).toBe(403);
    });

    it('rejects an address outside the allowList', async () => {
      const response = await send(server, { method: 'POST', path: '/oauth/token' }, DENIED_PEER);

      expect(response.status).toBe(403);
    });

    it('serves an allowListed address', async () => {
      const response = await rpc20260728(withCtx(server.handler, ALLOWED_PEER), 'tools/call', {
        name: 'ping',
        arguments: {},
      });

      expect(response.status).toBe(200);
    });
  });

  describe('each HTTP flow entered as Express enters it, with the socket peer', () => {
    let scope: Scope;

    beforeAll(async () => {
      const server = await serverWith({ denyList: ['203.0.113.0/24'] });
      scope = server.instance.getScopes()[0] as Scope;
    });

    function runWithPeer(flowName: FlowName, remoteAddress: string) {
      const request = { method: 'GET', path: '/', url: '/', headers: {}, query: {}, socket: { remoteAddress } };
      return scope.runFlow(flowName, { request, response: {} } as never);
    }

    it.each(HTTP_FLOWS)('%s rejects the IPv4-mapped form of a denied peer', async (flowName) => {
      expect(await runWithPeer(flowName, '::ffff:203.0.113.9')).toMatchObject({ status: 403 });
    });

    it('lets custom http.routes through for any other peer', async () => {
      expect(await runWithPeer('http:ip-filter', '198.51.100.7')).toBeUndefined();
    });
  });
});
