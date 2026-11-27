/**
 * The people sign-in page submitted the way a browser submits it (#1455): the form's POST carries the `Origin` the
 * page's `Referrer-Policy` lets through, `null` under `no-referrer`, which both the DNS-rebinding `Origin` check and
 * the route's own same-origin check refuse.
 */
import 'reflect-metadata';

import { LoopbackTokenAuth } from '@frontmcp/auth';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { disposeServers, inputValue } from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, type FrontMcpConfigInput } from '../../common';
import type { Scope } from '../../scope/scope.instance';

@App({ id: 'desk', name: 'Desk' })
class DeskApp {}

const ORIGIN = 'https://desk.example.com';
const servers: TestFetchServer[] = [];

beforeAll(() => {
  jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterAll(async () => {
  await disposeServers(servers);
  jest.restoreAllMocks();
});

async function serverWith(http: FrontMcpConfigInput['http']): Promise<TestFetchServer> {
  const server = await createTestFetchServer({ info: { name: 'desk', version: '1.0.0' }, apps: [DeskApp], http });
  servers.push(server);
  return server;
}

function peopleAuth(server: TestFetchServer): LoopbackTokenAuth {
  const auth = (server.instance.getScopes()[0] as Scope).httpRouteTable?.people;
  if (!auth) throw new Error('people auth is not set up');
  return auth;
}

/** Open the page a sign-in link opens, then submit its form as a browser would. */
async function submitSignInPage(server: TestFetchServer): Promise<{ page: Response; login: Response }> {
  const { code } = peopleAuth(server).createCode();
  const url = new URL(`/_frontmcp/people/login?code=${code}&next=/board`, ORIGIN);
  const page = await server.handler(new Request(url, { headers: { host: url.host } }));
  const html = await page.text();
  const action = /<form method="post" action="([^"]+)">/.exec(html)?.[1];
  if (!action) throw new Error('the page has no form');
  const policy = page.headers.get('referrer-policy') ?? 'strict-origin-when-cross-origin';
  const headers: Record<string, string> = {
    host: url.host,
    origin: policy === 'no-referrer' ? 'null' : url.origin,
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (policy !== 'no-referrer') headers['referer'] = url.href;
  const body = new URLSearchParams({ code: inputValue(html, 'code') ?? '', next: inputValue(html, 'next') ?? '' });
  const login = await server.handler(new Request(new URL(action, url), { method: 'POST', headers, body }));
  return { page, login };
}

function postCode(server: TestFetchServer, origin: string): Promise<Response> {
  const { code } = peopleAuth(server).createCode();
  return server.handler(
    new Request(new URL('/_frontmcp/people/login', ORIGIN), {
      method: 'POST',
      headers: { host: 'desk.example.com', origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code }),
    }),
  );
}

describe('the people sign-in page, submitted by a browser', () => {
  describe('behind DNS-rebinding protection that checks Origin', () => {
    let server: TestFetchServer;

    beforeAll(async () => {
      server = await serverWith({
        auth: { people: 'loopback-token' },
        security: {
          dnsRebindingProtection: { enabled: true, allowedHosts: ['desk.example.com'], allowedOrigins: [ORIGIN] },
        },
      });
    });

    it('signs the person in', async () => {
      const { page, login } = await submitSignInPage(server);

      expect({ status: login.status, body: login.status === 200 ? 'signed in' : await login.text() }).toEqual({
        status: 200,
        body: 'signed in',
      });
      expect(login.headers.get('set-cookie')).toMatch(/^frontmcp_people=/);
      expect(page.headers.get('referrer-policy')).toBe('same-origin');
      expect(login.headers.get('referrer-policy')).toBe('same-origin');
    });

    it('still refuses a sign-in posted with Origin: null, and says why', async () => {
      const login = await postCode(server, 'null');

      expect(login.status).toBe(403);
      expect(login.headers.get('set-cookie')).toBeNull();
      expect(await login.json()).toEqual({
        error: 'Forbidden',
        message: expect.stringMatching(/^Invalid Origin header: null \(.*Referrer-Policy: no-referrer/),
      });
    });

    it('still refuses a sign-in posted from another site', async () => {
      const login = await postCode(server, 'https://evil.example');

      expect(login.status).toBe(403);
      expect(await login.json()).toEqual({ error: 'Forbidden', message: 'Invalid Origin header' });
    });
  });

  describe("with only the route's own same-origin check", () => {
    let server: TestFetchServer;

    beforeAll(async () => {
      server = await serverWith({ auth: { people: 'loopback-token' } });
    });

    it('signs the person in', async () => {
      const { login } = await submitSignInPage(server);

      expect(login.status).toBe(200);
      expect(login.headers.get('set-cookie')).toMatch(/^frontmcp_people=/);
    });

    it('still refuses a sign-in posted with Origin: null', async () => {
      const login = await postCode(server, 'null');

      expect(login.status).toBe(403);
      expect(login.headers.get('set-cookie')).toBeNull();
    });
  });
});
