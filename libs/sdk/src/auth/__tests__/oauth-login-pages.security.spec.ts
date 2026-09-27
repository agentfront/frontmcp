/**
 * The built-in sign-in and consent pages (#263), driven as a browser would:
 *
 * - forms are POSTed, so a password never lands in the callback URL (browser
 *   history, proxy and access logs);
 * - a refused sign-in never writes the typed password back into the page;
 * - the consent form carries no login fields: the verified sign-in is kept on
 *   the server until consent is given;
 * - every page is sent with CSP, anti-framing and referrer headers.
 */
import 'reflect-metadata';

import { createTestFetchServer, type TestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  authorizePath,
  decodeJwtPayload,
  disposeServers,
  exchangeCode,
  httpGet,
  inputValue,
  postForm,
  redirectParams,
} from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, Tool, ToolContext } from '../../common';

@Tool({ name: 'list_tickets', inputSchema: {} })
class ListTicketsTool extends ToolContext {
  async execute() {
    return { tickets: [] };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [ListTicketsTool] })
class DeskApp {}

const CLIENT_ID = 'desk-client';
const REDIRECT_URI = 'http://127.0.0.1:5555/cb';
const HOST = 'desk.example.com';
const PASSWORD = 's3cret-pass-4521';

let server: TestFetchServer;

beforeAll(async () => {
  server = await createTestFetchServer({
    info: { name: 'login-pages', version: '1.0.0' },
    apps: [DeskApp],
    auth: {
      mode: 'local',
      dcr: { clients: [{ clientId: CLIENT_ID, redirectUris: [REDIRECT_URI] }] },
      // Every sign-in shows the consent screen (no remembered selection between tests).
      consent: { enabled: true, rememberConsent: false },
      login: {
        fields: {
          username: { type: 'text', label: 'Username', required: true },
          password: { type: 'password', label: 'Password', required: true },
        },
      },
      authenticate: async ({ fields }) =>
        fields['username'] === 'nour' && fields['password'] === PASSWORD
          ? { ok: true, sub: 'user-nour' }
          : { ok: false, message: 'Wrong username or password.' },
    },
  });
});

afterAll(async () => {
  await disposeServers([server]);
});

async function openSignInPage(): Promise<{ response: Response; html: string; pendingAuthId: string }> {
  const response = await httpGet(
    server.handler,
    authorizePath({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, state: 'st' }),
    HOST,
  );
  const html = await response.text();
  const pendingAuthId = inputValue(html, 'pending_auth_id');
  if (!pendingAuthId) throw new Error(`no pending_auth_id on the sign-in page (HTTP ${response.status})`);
  return { response, html, pendingAuthId };
}

/** The first form on a page: its method, its action and its hidden inputs. */
function formOf(html: string): { method: string; action: string; hidden: Record<string, string> } {
  const form = /<form[^>]*method="([A-Za-z]+)"[^>]*action="([^"]+)"/.exec(html);
  if (!form) throw new Error('no form on the page');
  const hidden: Record<string, string> = {};
  for (const match of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) {
    hidden[match[1]] = match[2];
  }
  return { method: form[1].toUpperCase(), action: form[2], hidden };
}

/** Send fields with the given method, as a browser submitting that form would. */
function send(method: string, action: string, fields: Record<string, string | string[]>): Promise<Response> {
  if (method === 'POST') return postForm(server.handler, action, fields, HOST, { origin: `http://${HOST}` });
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) query.append(key, item);
  }
  return httpGet(server.handler, `${action}?${query.toString()}`, HOST);
}

/** Submit a rendered form the way a browser does: its own method, its own hidden inputs, plus `extra`. */
function submitForm(html: string, extra: Record<string, string | string[]>): Promise<Response> {
  const { method, action, hidden } = formOf(html);
  return send(method, action, { ...hidden, ...extra });
}

describe('built-in sign-in and consent pages (#263)', () => {
  it('posts the sign-in form, so its fields never reach the callback URL', async () => {
    const { html } = await openSignInPage();

    expect(html).toMatch(/<form method="POST" action="\/oauth\/callback"/);
    expect(html).not.toMatch(/<form method="GET"/);
  });

  it('accepts the sign-in form as a POST', async () => {
    const { pendingAuthId } = await openSignInPage();

    const response = await postForm(
      server.handler,
      '/oauth/callback',
      { pending_auth_id: pendingAuthId, username: 'nour', password: PASSWORD },
      HOST,
      { origin: `http://${HOST}` },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Select Tools to Enable');
  });

  it('does not write the typed password back into the page after a refused sign-in', async () => {
    const { html: signInPage } = await openSignInPage();
    const typed = 'typo-pass-9981';

    const response = await submitForm(signInPage, { username: 'nour', password: typed });
    const html = await response.text();

    expect(html).toContain('Wrong username or password.');
    expect(html).toContain('value="nour"');
    expect(html).not.toContain(typed);
  });

  it('keeps login fields out of the consent form and completes consent from the server-side sign-in', async () => {
    const { html: signInPage } = await openSignInPage();
    const consent = await submitForm(signInPage, { username: 'nour', password: PASSWORD });
    const consentPage = await consent.text();

    expect(consent.status).toBe(200);
    expect(consentPage).toContain('Select Tools to Enable');
    expect(consentPage).not.toContain(PASSWORD);
    expect(consentPage).not.toMatch(/name="password"/);
    expect(consentPage).not.toMatch(/name="username"/);

    // The browser submits exactly what the consent form holds, plus the ticked tool.
    const done = await submitForm(consentPage, { tools: 'list_tickets' });
    expect(done.status).toBe(302);
    const code = redirectParams(done).get('code') ?? '';

    const tokens = await exchangeCode(server.handler, { code, clientId: CLIENT_ID, redirectUri: REDIRECT_URI }, HOST);
    expect(tokens.status).toBe(200);
    expect(decodeJwtPayload(String(tokens.body['access_token']))['sub']).toBe('user-nour');
  });

  it('refuses a consent submission without the consent page token', async () => {
    const { html: signInPage } = await openSignInPage();
    const consentPage = await (await submitForm(signInPage, { username: 'nour', password: PASSWORD })).text();
    const { method, action } = formOf(consentPage);

    // Everything the consent form needs except its token.
    const forged = await send(method, action, {
      pending_auth_id: inputValue(consentPage, 'pending_auth_id') ?? '',
      consent_submitted: '1',
      tools: 'list_tickets',
    });

    expect(forged.status).toBe(400);
    expect(forged.headers.get('location')).toBeNull();
  });

  it('sends CSP, anti-framing and referrer headers with the sign-in page and error pages', async () => {
    const { response } = await openSignInPage();
    const errorPage = await httpGet(server.handler, '/oauth/callback', HOST);

    for (const page of [response, errorPage]) {
      expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
      expect(page.headers.get('x-frame-options')).toBe('DENY');
      expect(page.headers.get('referrer-policy')).toBe('same-origin');
      expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    }
  });
});
