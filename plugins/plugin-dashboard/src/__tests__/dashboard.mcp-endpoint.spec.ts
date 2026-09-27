/**
 * The dashboard's MCP endpoint obeys `enabled`, `auth` and `basePath`, not just its web page.
 *
 * In 1.8.2 those options only reached the middleware that serves the HTML page. The page
 * holds no data: the inventory comes from the dashboard's own MCP endpoint (`POST /dashboard`,
 * with `dashboard:graph`, `dashboard:list-tools` and `dashboard:list-resources`), which stayed
 * open with `enabled: false`, without the configured token, and at `/dashboard` whatever
 * `basePath` said. These tests drive a real Node HTTP server built by `createHandler`, the
 * same Express router `frontmcp` serves in production.
 */
import 'reflect-metadata';

import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

import { App, FrontMcpInstance, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';

import { DashboardApp } from '../app/dashboard.app';
import { resetDashboardOptions } from '../dashboard.config-store';
import DashboardPlugin from '../dashboard.plugin';
import type { DashboardPluginOptionsInput } from '../dashboard.types';

const TOKEN = 'dashboard-test-token';
/** A tool whose name is the secret the inventory would leak. */
const CANARY = 'export_revenue_canary';

@Tool({ name: CANARY, description: 'Internal revenue export', inputSchema: {} })
class CanaryTool extends ToolContext {
  async execute() {
    return 'ok';
  }
}

@App({ id: 'lab', name: 'Lab', tools: [CanaryTool] })
class LabApp {}

interface Running {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startServer(options: DashboardPluginOptionsInput): Promise<Running> {
  resetDashboardOptions();
  const app = (await FrontMcpInstance.createHandler({
    info: { name: 'inventory', version: '1.0.0' },
    apps: [LabApp, DashboardApp],
    plugins: [DashboardPlugin.init(options)],
    logging: { level: LogLevel.Off, enableConsole: false },
  })) as http.RequestListener;
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const PROTOCOL = '2026-07-28';

/** Whether a response carried any tool result (and so, possibly, the inventory). */
function answered(body: string): boolean {
  return body.includes(CANARY) || body.includes('"result"');
}

/** A stateless (2026-07-28) `tools/call`: one POST, no session needed. */
async function callTool(
  baseUrl: string,
  path: string,
  name: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': PROTOCOL,
      'mcp-method': 'tools/call',
      'mcp-name': name,
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name,
        arguments: {},
        _meta: {
          'io.modelcontextprotocol/protocolVersion': PROTOCOL,
          'io.modelcontextprotocol/clientInfo': { name: 'dashboard-spec', version: '1.0.0' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  });
  return { status: res.status, body: await res.text() };
}

/** A legacy (2025-06-18) `initialize`, which opens a session on the dashboard scope. */
async function initialize(
  baseUrl: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; sessionId: string | null }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dashboard-spec', version: '1' } },
    }),
  });
  await res.text();
  return { status: res.status, sessionId: res.headers.get('mcp-session-id') };
}

/** A `tools/call` on a legacy (2025-06-18) session opened by {@link initialize}. */
async function callToolInSession(
  baseUrl: string,
  sessionId: string,
  name: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  const res = await fetch(`${baseUrl}/dashboard`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
      'mcp-protocol-version': '2025-06-18',
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: {} } }),
  });
  return { status: res.status, body: await res.text() };
}

describe('Dashboard MCP endpoint', () => {
  describe('enabled: false', () => {
    let server: Running;
    beforeAll(async () => {
      server = await startServer({ enabled: false });
    });
    afterAll(async () => {
      await server.close();
      resetDashboardOptions();
    });

    it('does not serve the inventory tools', async () => {
      const res = await callTool(server.baseUrl, '/dashboard', 'dashboard:graph');

      expect(answered(res.body)).toBe(false);
      expect(res.status).toBe(404);
    });

    it('does not open an MCP session on the dashboard endpoint', async () => {
      const res = await initialize(server.baseUrl, '/dashboard');

      expect(res.sessionId).toBeNull();
      expect(res.status).toBe(404);
    });

    it('does not serve the page either', async () => {
      const res = await fetch(`${server.baseUrl}/dashboard`);
      const body = await res.text();

      expect(res.status).toBe(404);
      expect(body).not.toContain('FrontMCP Dashboard');
    });
  });

  describe('the production default (no `enabled`)', () => {
    let server: Running;
    const previous = process.env['NODE_ENV'];
    beforeAll(async () => {
      process.env['NODE_ENV'] = 'production';
      server = await startServer({});
    });
    afterAll(async () => {
      await server.close();
      process.env['NODE_ENV'] = previous;
      resetDashboardOptions();
    });

    it('keeps the MCP endpoint off as well as the page', async () => {
      const res = await callTool(server.baseUrl, '/dashboard', 'dashboard:graph');

      expect(answered(res.body)).toBe(false);
      expect(res.status).toBe(404);
    });
  });

  describe('auth: { enabled: true, token }', () => {
    let server: Running;
    beforeAll(async () => {
      server = await startServer({ enabled: true, auth: { enabled: true, token: TOKEN } });
    });
    afterAll(async () => {
      await server.close();
      resetDashboardOptions();
    });

    it.each(['dashboard:graph', 'dashboard:list-tools', 'dashboard:list-resources'])(
      'refuses %s without the token',
      async (tool) => {
        const res = await callTool(server.baseUrl, '/dashboard', tool);

        expect(answered(res.body)).toBe(false);
        expect(res.status).toBe(401);
      },
    );

    it('refuses a wrong token', async () => {
      const res = await callTool(server.baseUrl, '/dashboard', 'dashboard:graph', {
        'x-frontmcp-dashboard-token': 'not-the-token',
      });

      expect(answered(res.body)).toBe(false);
      expect(res.status).toBe(401);
    });

    it('does not accept the token in the query string on the MCP endpoint', async () => {
      const res = await callTool(server.baseUrl, `/dashboard?token=${TOKEN}`, 'dashboard:graph');

      expect(answered(res.body)).toBe(false);
      expect(res.status).toBe(401);
    });

    it('refuses to open a session without the token', async () => {
      const res = await initialize(server.baseUrl, '/dashboard');

      expect(res.sessionId).toBeNull();
      expect(res.status).toBe(401);
    });

    it('serves the inventory with the token in x-frontmcp-dashboard-token', async () => {
      const res = await callTool(server.baseUrl, '/dashboard', 'dashboard:graph', {
        'x-frontmcp-dashboard-token': TOKEN,
      });

      expect(res.status).toBe(200);
      expect(res.body).toContain(CANARY);
    });

    it('serves the inventory with the token as a bearer credential', async () => {
      const res = await callTool(server.baseUrl, '/dashboard', 'dashboard:graph', {
        authorization: `Bearer ${TOKEN}`,
      });

      expect(res.status).toBe(200);
      expect(res.body).toContain(CANARY);
    });

    it('lets the page it served reach the MCP endpoint through an HttpOnly cookie', async () => {
      const page = await fetch(`${server.baseUrl}/dashboard?token=${TOKEN}`);
      await page.text();
      const setCookie = page.headers.getSetCookie();
      const cookie = setCookie.find((c) => c.startsWith('frontmcp_dashboard='));

      expect(cookie).toBeDefined();
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      // The cookie is a derived value, never the configured token itself.
      expect(cookie).not.toContain(TOKEN);

      const res = await callTool(server.baseUrl, '/dashboard', 'dashboard:graph', {
        cookie: (cookie ?? '').split(';')[0],
      });

      expect(res.status).toBe(200);
      expect(res.body).toContain(CANARY);
    });

    it("lets the page's own SSE client (GET /dashboard/sse) in with the cookie, and nobody without it", async () => {
      const page = await fetch(`${server.baseUrl}/dashboard?token=${TOKEN}`);
      await page.text();
      const cookie = (page.headers.getSetCookie().find((c) => c.startsWith('frontmcp_dashboard=')) ?? '').split(';')[0];

      const refused = await fetch(`${server.baseUrl}/dashboard/sse`, { headers: { accept: 'text/event-stream' } });
      await refused.text();
      expect(refused.status).toBe(401);

      const controller = new AbortController();
      try {
        const stream = await fetch(`${server.baseUrl}/dashboard/sse`, {
          headers: { accept: 'text/event-stream', cookie },
          signal: controller.signal,
        });
        expect(stream.status).toBe(200);
        const reader = stream.body?.getReader();
        const decoder = new TextDecoder();
        let events = '';
        while (reader && !events.includes('event: endpoint')) {
          const { value, done } = await reader.read();
          if (done) break;
          events += decoder.decode(value);
        }
        expect(events).toContain('/dashboard/message');
      } finally {
        controller.abort();
      }
    });

    it('does not accept a forged cookie', async () => {
      const res = await callTool(server.baseUrl, '/dashboard', 'dashboard:graph', {
        cookie: `frontmcp_dashboard=${TOKEN}`,
      });

      expect(answered(res.body)).toBe(false);
      expect(res.status).toBe(401);
    });

    it('serves a legacy session opened with the token, and checks the token on every request', async () => {
      const auth = { 'x-frontmcp-dashboard-token': TOKEN };
      const opened = await initialize(server.baseUrl, '/dashboard', auth);
      expect(opened.status).toBe(200);
      expect(opened.sessionId).toBeTruthy();
      const sessionId = opened.sessionId ?? '';
      await fetch(`${server.baseUrl}/dashboard`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-session-id': sessionId,
          'mcp-protocol-version': '2025-06-18',
          ...auth,
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      }).then((r) => r.text());

      const withToken = await callToolInSession(server.baseUrl, sessionId, 'dashboard:graph', auth);
      expect(withToken.body).toContain(CANARY);

      // A session id is not a credential for the dashboard: the token is checked again.
      const withoutToken = await callToolInSession(server.baseUrl, sessionId, 'dashboard:graph');
      expect(withoutToken.status).toBe(401);
      expect(answered(withoutToken.body)).toBe(false);
    });

    it('leaves the main MCP endpoint alone', async () => {
      const res = await callTool(server.baseUrl, '/', CANARY);

      expect(res.status).toBe(200);
      expect(res.body).toContain('"result"');
    });
  });

  describe('basePath', () => {
    let server: Running;
    beforeAll(async () => {
      server = await startServer({ enabled: true, basePath: '/ops', auth: { enabled: true, token: TOKEN } });
    });
    afterAll(async () => {
      await server.close();
      resetDashboardOptions();
    });

    it('keeps the token requirement on the MCP endpoint when the page moves', async () => {
      const res = await callTool(server.baseUrl, '/dashboard', 'dashboard:graph');

      expect(answered(res.body)).toBe(false);
      expect(res.status).toBe(401);
    });

    it('serves the page at basePath, pointing its client at the real MCP endpoint', async () => {
      const res = await fetch(`${server.baseUrl}/ops`, { headers: { authorization: `Bearer ${TOKEN}` } });
      const html = await res.text();

      expect(res.status).toBe(200);
      expect(html).toContain("'/dashboard/sse'");
      expect(html).not.toContain("'/ops/sse'");
    });
  });

  describe('basePath with enabled: false', () => {
    let server: Running;
    beforeAll(async () => {
      server = await startServer({ enabled: false, basePath: '/ops' });
    });
    afterAll(async () => {
      await server.close();
      resetDashboardOptions();
    });

    it('turns the MCP endpoint off too', async () => {
      const res = await callTool(server.baseUrl, '/dashboard', 'dashboard:graph');

      expect(answered(res.body)).toBe(false);
      expect(res.status).toBe(404);
    });
  });
});

/**
 * The same checks inside the tools, for servers where no HTTP request reaches the dashboard
 * scope's gate: `createDirect`, stdio and the fetch handler serve the FIRST scope, which is
 * the dashboard's standalone scope when `DashboardApp` is in `apps`.
 */
describe('Dashboard tools without the HTTP gate', () => {
  async function directServer(options: DashboardPluginOptionsInput) {
    resetDashboardOptions();
    return FrontMcpInstance.createDirect({
      info: { name: 'inventory', version: '1.0.0' },
      apps: [LabApp, DashboardApp],
      plugins: [DashboardPlugin.init(options)],
      logging: { level: LogLevel.Off, enableConsole: false },
    });
  }

  afterAll(() => resetDashboardOptions());

  it('refuses when the dashboard is disabled', async () => {
    const server = await directServer({ enabled: false });
    try {
      await expect(server.callTool('dashboard:graph', {})).rejects.toMatchObject({ code: 'DASHBOARD_DISABLED' });
    } finally {
      await server.dispose();
    }
  });

  it('refuses without the token when auth is on', async () => {
    const server = await directServer({ enabled: true, auth: { enabled: true, token: TOKEN } });
    try {
      await expect(server.callTool('dashboard:graph', {})).rejects.toMatchObject({ code: 'DASHBOARD_UNAUTHORIZED' });
    } finally {
      await server.dispose();
    }
  });

  it('still answers when enabled with no auth (development)', async () => {
    const server = await directServer({ enabled: true });
    try {
      const result = await server.callTool('dashboard:graph', {});

      expect(result.isError).toBeFalsy();
      expect(JSON.stringify(result)).toContain(CANARY);
    } finally {
      await server.dispose();
    }
  });
});

/**
 * `createFetchHandler` serves one scope, the first, which is the dashboard's standalone scope
 * when `DashboardApp` is in `apps`; no Express middleware runs there. The gate is a hook on
 * the scope's own `http:request` flow, so it holds on this path too.
 */
describe('Dashboard MCP endpoint through createFetchHandler', () => {
  async function fetchHandler(options: DashboardPluginOptionsInput) {
    resetDashboardOptions();
    return FrontMcpInstance.createFetchHandler({
      info: { name: 'inventory', version: '1.0.0' },
      apps: [LabApp, DashboardApp],
      plugins: [DashboardPlugin.init(options)],
      logging: { level: LogLevel.Off, enableConsole: false },
    });
  }

  function graphRequest(headers: Record<string, string> = {}): Request {
    return new Request('http://localhost/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': PROTOCOL,
        'mcp-method': 'tools/call',
        'mcp-name': 'dashboard:graph',
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'dashboard:graph',
          arguments: {},
          _meta: {
            'io.modelcontextprotocol/protocolVersion': PROTOCOL,
            'io.modelcontextprotocol/clientInfo': { name: 'dashboard-spec', version: '1.0.0' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    });
  }

  afterAll(() => resetDashboardOptions());

  it('refuses the inventory when the dashboard is disabled', async () => {
    const handler = await fetchHandler({ enabled: false });
    const res = await handler(graphRequest());
    const body = await res.text();

    expect(answered(body)).toBe(false);
    expect(res.status).toBe(404);
  });

  it('refuses the inventory without the token, and serves it with the token', async () => {
    const handler = await fetchHandler({ enabled: true, auth: { enabled: true, token: TOKEN } });

    const refused = await handler(graphRequest());
    expect(answered(await refused.text())).toBe(false);
    expect(refused.status).toBe(401);

    const served = await handler(graphRequest({ 'x-frontmcp-dashboard-token': TOKEN }));
    expect(await served.text()).toContain(CANARY);
  });
});
