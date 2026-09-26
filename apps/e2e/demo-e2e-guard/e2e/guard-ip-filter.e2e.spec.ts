/** Guard IP filter over a real socket (GHSA-hwfp-xv2f-fr8g); FRONTMCP_TRUST_PROXY lets X-Forwarded-For stand in for other clients. */
import { expect, test } from '@frontmcp/testing';

const IP_FILTER_REJECTION = { error: 'forbidden', message: 'Client IP rejected by ipFilter' };

async function initializeAs(baseUrl: string, clientIp: string): Promise<Response> {
  return fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'x-forwarded-for': clientIp,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'ip-filter-e2e', version: '1.0.0' },
      },
    }),
  });
}

async function getAs(baseUrl: string, path: string, clientIp: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: { 'x-forwarded-for': clientIp } });
}

test.describe('Guard IP Filter', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-guard/src/main-ip-filter.ts',
    project: 'demo-e2e-guard',
    publicMode: true,
    env: { FRONTMCP_TRUST_PROXY: 'true' },
  });

  test('should block denied IPs', async ({ server }) => {
    const mcp = await initializeAs(server.info.baseUrl, '203.0.113.7');
    const mcpBody = (await mcp.json()) as { error?: { code?: number } };
    const discovery = await getAs(server.info.baseUrl, '/.well-known/oauth-protected-resource', '203.0.113.7');
    const token = await fetch(`${server.info.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '203.0.113.7' },
      body: 'grant_type=anonymous',
    });

    expect({ status: mcp.status, code: mcpBody.error?.code }).toEqual({ status: 403, code: -32001 });
    expect({ status: discovery.status, body: await discovery.json() }).toEqual({
      status: 403,
      body: IP_FILTER_REJECTION,
    });
    expect(token.status).toBe(403);
  });

  test('should allow allowlisted IPs', async ({ mcp, server }) => {
    const forwarded = await initializeAs(server.info.baseUrl, '198.51.100.7');
    const discovery = await getAs(server.info.baseUrl, '/.well-known/oauth-protected-resource', '198.51.100.7');

    expect(forwarded.status).toBe(200);
    expect(discovery.status).toBe(200);

    // No forwarded header: the loopback socket peer, which a dual-stack socket reports as ::ffff:127.0.0.1.
    const result = await mcp.tools.call('unguarded', { value: 'from-loopback' });
    expect(result).toBeSuccessful();
  });

  test('should apply default deny action when IP matches neither list', async ({ server }) => {
    const mcp = await initializeAs(server.info.baseUrl, '192.0.2.10');
    const discovery = await getAs(server.info.baseUrl, '/.well-known/oauth-authorization-server', '192.0.2.10');
    const liveness = await getAs(server.info.baseUrl, '/healthz', '192.0.2.10');

    expect(mcp.status).toBe(403);
    expect(discovery.status).toBe(403);
    expect(liveness.status).toBe(200);
  });

  test('should support CIDR ranges for IPv4 and IPv6', async ({ server }) => {
    const statuses: Record<string, number> = {};
    for (const clientIp of [
      '198.51.100.20',
      '198.51.100.200',
      '2001:db8:1::5',
      '2001:db8:dead::1',
      '::ffff:198.51.100.20',
      '::ffff:203.0.113.7',
    ]) {
      statuses[clientIp] = (await initializeAs(server.info.baseUrl, clientIp)).status;
    }

    expect(statuses).toEqual({
      '198.51.100.20': 200,
      '198.51.100.200': 403,
      '2001:db8:1::5': 200,
      '2001:db8:dead::1': 403,
      '::ffff:198.51.100.20': 200,
      '::ffff:203.0.113.7': 403,
    });
  });
});
