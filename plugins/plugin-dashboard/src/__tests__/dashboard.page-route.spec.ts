/**
 * The dashboard page is an `@HttpRoute` of `DashboardApp`, so every adapter serves it through the `http:route` flow,
 * behind `throttle.ipFilter`, with the dashboard's own token gate. The fetch handler used to answer it 404.
 */
import 'reflect-metadata';

import { FrontMcpInstance, LogLevel, type FrontMcpConfigInput } from '@frontmcp/sdk';

import { DashboardApp } from '../app/dashboard.app';
import { resetDashboardOptions } from '../dashboard.config-store';
import DashboardPlugin from '../dashboard.plugin';
import { type DashboardPluginOptionsInput } from '../dashboard.types';

const TOKEN = 'operator-token';

type Handler = (request: Request, ctx?: { remoteAddr?: { hostname: string } }) => Promise<Response>;

async function serve(
  options: DashboardPluginOptionsInput,
  throttle?: FrontMcpConfigInput['throttle'],
): Promise<Handler> {
  return (await FrontMcpInstance.createFetchHandler({
    info: { name: 'dashboard-page', version: '1.0.0' },
    apps: [DashboardApp],
    plugins: [DashboardPlugin.init(options)],
    logging: { level: LogLevel.Off, enableConsole: false },
    throttle,
  })) as Handler;
}

function get(handler: Handler, path: string, headers: Record<string, string> = {}): Promise<Response> {
  return handler(new Request(`http://localhost${path}`, { headers }));
}

afterEach(() => resetDashboardOptions());

describe('the dashboard page route', () => {
  it('serves the page', async () => {
    const response = await get(await serve({ enabled: true }), '/dashboard');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.text()).toContain("mcpPath: '/dashboard'");
  });

  it('moves with basePath', async () => {
    const handler = await serve({ enabled: true, basePath: '/ops' });

    expect((await get(handler, '/ops')).status).toBe(200);
  });

  it('answers 404 when the dashboard is off', async () => {
    const response = await get(await serve({ enabled: false }), '/dashboard');

    expect(response.status).toBe(404);
  });

  describe('with auth', () => {
    let handler: Handler;

    beforeEach(async () => {
      handler = await serve({ enabled: true, auth: { enabled: true, token: TOKEN } });
    });

    it('refuses a request without the token', async () => {
      const response = await get(handler, '/dashboard');

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'Unauthorized', message: 'Unauthorized' });
    });

    it.each([
      ['as a query parameter', `/dashboard?token=${TOKEN}`, {}],
      ['as a bearer header', '/dashboard', { Authorization: `Bearer ${TOKEN}` }],
    ])('serves the page for the token %s, with HttpOnly SameSite=Strict cookies', async (_case, path, headers) => {
      const response = await get(handler, path, headers);

      expect(response.status).toBe(200);
      expect(await response.text()).not.toContain(TOKEN);
      const cookie = response.headers.get('set-cookie') ?? '';
      expect(cookie).toMatch(/frontmcp_dashboard=[A-Za-z0-9_-]+; Path=\/dashboard; HttpOnly; SameSite=Strict/);
      expect(cookie).not.toContain(TOKEN);
    });

    it('sets the cookie Secure over https', async () => {
      const response = await handler(new Request(`https://localhost/dashboard?token=${TOKEN}`));

      expect(response.headers.get('set-cookie')).toContain('Secure');
    });
  });

  it('is behind throttle.ipFilter', async () => {
    const handler = await serve({ enabled: true }, { enabled: true, ipFilter: { denyList: ['203.0.113.0/24'] } });

    const response = await handler(new Request('http://localhost/dashboard'), {
      remoteAddr: { hostname: '203.0.113.9' },
    });

    expect(response.status).toBe(403);
  });
});
