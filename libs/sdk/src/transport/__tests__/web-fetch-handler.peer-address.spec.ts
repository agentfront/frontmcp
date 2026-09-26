/** The web-fetch adapter carries the platform's peer address, so edge requests have a client IP (GHSA-p3qf-fcwm-35x4). */
import 'reflect-metadata';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext } from '../../common';
import { type Scope } from '../../scope/scope.instance';
import { runHttpRequestFlowWeb, type FetchHandlerCtx, type WebFetchHandler } from '../web-fetch-handler';

@Tool({ name: 'whoami', inputSchema: {} })
class WhoAmITool extends ToolContext {
  async execute() {
    return { clientIp: this.context.metadata.clientIp ?? null };
  }
}

@Tool({ name: 'limited', inputSchema: {}, rateLimit: { maxRequests: 2, windowMs: 60_000, partitionBy: 'ip' } })
class LimitedTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

@App({ id: 'peer', name: 'peer', tools: [WhoAmITool, LimitedTool] })
class PeerApp {}

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

function runOnCloudflareWorkers(): void {
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Cloudflare-Workers' }, configurable: true });
}

function restoreNavigator(): void {
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
}

function withCtx(handler: WebFetchHandler, ctx: FetchHandlerCtx): WebFetchHandler {
  return (request) => handler(request, ctx);
}

async function clientIpSeenBy(handler: WebFetchHandler, headers: Record<string, string> = {}): Promise<unknown> {
  const { message } = await rpc20260728(handler, 'tools/call', { name: 'whoami', arguments: {} }, { headers });
  return (message.result?.['structuredContent'] as { clientIp: unknown } | undefined)?.clientIp;
}

async function callLimited(handler: WebFetchHandler, headers: Record<string, string> = {}): Promise<string> {
  const { message } = await rpc20260728(handler, 'tools/call', { name: 'limited', arguments: {} }, { headers });
  const result = message.result as { isError?: boolean; _meta?: { code?: string } } | undefined;
  return result?.isError ? String(result._meta?.code) : 'ok';
}

describe('web-fetch peer address (GHSA-p3qf-fcwm-35x4)', () => {
  let server: TestFetchServer;

  beforeEach(async () => {
    delete process.env['FRONTMCP_TRUST_PROXY'];
    server = await createTestFetchServer({
      info: { name: 'peer-address', version: '1.0.0' },
      apps: [PeerApp],
      throttle: { enabled: true },
    });
  });

  afterEach(() => {
    restoreNavigator();
  });

  describe('without a trusted proxy', () => {
    it('ignores a forged x-forwarded-for', async () => {
      expect(await clientIpSeenBy(server.handler, { 'x-forwarded-for': '198.51.100.7' })).toBeNull();
    });

    it('gives a rotating forged x-forwarded-for no fresh rate-limit buckets', async () => {
      const outcomes: string[] = [];
      for (const forged of ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4']) {
        outcomes.push(await callLimited(server.handler, { 'x-forwarded-for': forged }));
      }

      expect(outcomes).toEqual(['ok', 'ok', 'RATE_LIMIT_EXCEEDED', 'RATE_LIMIT_EXCEEDED']);
    });
  });

  describe('on Cloudflare Workers', () => {
    beforeEach(runOnCloudflareWorkers);

    it('attributes the request to CF-Connecting-IP', async () => {
      expect(await clientIpSeenBy(server.handler, { 'cf-connecting-ip': '203.0.113.9' })).toBe('203.0.113.9');
    });

    it('gives each CF-Connecting-IP its own rate-limit bucket', async () => {
      const first: string[] = [];
      for (let call = 0; call < 3; call++) {
        first.push(await callLimited(server.handler, { 'cf-connecting-ip': '203.0.113.9' }));
      }
      const other = await callLimited(server.handler, { 'cf-connecting-ip': '203.0.113.10' });

      expect({ first, other }).toEqual({ first: ['ok', 'ok', 'RATE_LIMIT_EXCEEDED'], other: 'ok' });
    });

    it('rejects a CF-Connecting-IP that is not an IP address', async () => {
      expect(await clientIpSeenBy(server.handler, { 'cf-connecting-ip': 'ip:unresolved' })).toBeNull();
    });

    it('attributes a request the Durable Object session host runs, which has no ctx', async () => {
      const scope = server.instance.getScopes()[0] as Scope;
      const durableObjectHandler: WebFetchHandler = async (request) =>
        (await runHttpRequestFlowWeb(scope, request)) ?? new Response(null, { status: 404 });

      expect(await clientIpSeenBy(durableObjectHandler, { 'cf-connecting-ip': '203.0.113.9' })).toBe('203.0.113.9');
    });
  });

  describe('off Cloudflare Workers', () => {
    it('treats CF-Connecting-IP as a claim by the caller', async () => {
      expect(await clientIpSeenBy(server.handler, { 'cf-connecting-ip': '203.0.113.9' })).toBeNull();
    });

    it('does not let a CF-Connecting-IP override the platform peer', async () => {
      const deno = withCtx(server.handler, { remoteAddr: { hostname: '198.51.100.7' } });

      expect(await clientIpSeenBy(deno, { 'cf-connecting-ip': '203.0.113.9' })).toBe('198.51.100.7');
    });

    it("uses Deno's info.remoteAddr", async () => {
      const deno = withCtx(server.handler, { remoteAddr: { hostname: '2001:db8::7' } });

      expect(await clientIpSeenBy(deno)).toBe('2001:db8::7');
    });

    it("uses Bun's server.requestIP(request)", async () => {
      const seenRequests: Request[] = [];
      const bunServer = {
        requestIP(request: Request) {
          seenRequests.push(request);
          return { address: '::ffff:198.51.100.7', family: 'IPv6', port: 50123 };
        },
      };

      expect(await clientIpSeenBy(withCtx(server.handler, bunServer))).toBe('::ffff:198.51.100.7');
      expect(seenRequests.length).toBeGreaterThan(0);
    });

    it('has no client IP when Bun cannot report one', async () => {
      const bun = withCtx(server.handler, { requestIP: () => null });

      expect(await clientIpSeenBy(bun)).toBeNull();
    });
  });
});
