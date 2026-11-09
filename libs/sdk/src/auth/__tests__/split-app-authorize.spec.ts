/**
 * With `splitByApp`, each app that declares its own auth is its own authorization server: its discovery document
 * names endpoints under the app's path, and those endpoints run the app's own auth, not the first app's.
 */
import 'reflect-metadata';

import {
  authorizePath,
  httpGet,
  inputValue,
  PKCE_VERIFIER,
  postForm,
  redirectParams,
} from '../../__test-utils__/helpers/oauth-flow.helpers';
import { App, LogLevel, Tool, ToolContext } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type WebFetchHandler } from '../../transport/web-fetch-handler';

@Tool({ name: 'charge', inputSchema: {} })
class ChargeTool extends ToolContext {
  async execute() {
    return 'charged';
  }
}

@Tool({ name: 'open_ticket', inputSchema: {} })
class OpenTicketTool extends ToolContext {
  async execute() {
    return 'opened';
  }
}

const HOST = 'gateway.example.com';
const REDIRECT = 'http://127.0.0.1:5555/cb';

function remoteAuth(provider: string, clientId: string) {
  return { mode: 'remote', provider, clientId, requireRegisteredClients: false } as const;
}

@App({
  id: 'billing',
  name: 'Billing',
  auth: remoteAuth('https://idp-billing.example.com', 'billing'),
  tools: [ChargeTool],
})
class BillingApp {}

@App({
  id: 'support',
  name: 'Support',
  auth: remoteAuth('https://idp-support.example.com', 'support'),
  tools: [OpenTicketTool],
})
class SupportApp {}

@App({
  id: 'desk',
  name: 'Desk',
  auth: { mode: 'local', dcr: { clients: [{ clientId: 'desk-client', redirectUris: [REDIRECT] }] } },
  tools: [OpenTicketTool],
})
class DeskApp {}

async function discover(handler: WebFetchHandler, appId: string): Promise<Record<string, string>> {
  const response = await httpGet(handler, `/.well-known/oauth-authorization-server/${appId}`, HOST);
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, string>;
}

function pathOf(url: string): string {
  return new URL(url).pathname;
}

describe('splitByApp: each app with its own auth is its own authorization server', () => {
  let handler: WebFetchHandler;

  beforeAll(async () => {
    handler = await FrontMcpInstance.createFetchHandler({
      info: { name: 'split-auth', version: '1.0.0' },
      apps: [BillingApp, SupportApp],
      splitByApp: true,
      logging: { level: LogLevel.Off },
    });
  });

  it.each(['billing', 'support'])("advertises the %s app's endpoints under the app's path", async (appId) => {
    const metadata = await discover(handler, appId);

    expect(pathOf(metadata['authorization_endpoint'])).toBe(`/${appId}/oauth/authorize`);
    expect(pathOf(metadata['token_endpoint'])).toBe(`/${appId}/oauth/token`);
  });

  it.each([
    ['billing', 'idp-billing.example.com'],
    ['support', 'idp-support.example.com'],
  ])("sends a sign-in at the %s app's authorization endpoint to that app's provider", async (appId, providerHost) => {
    const metadata = await discover(handler, appId);
    const query = authorizePath({ client_id: 'mcp-client', redirect_uri: REDIRECT, state: 's' }).split('?')[1];

    const response = await httpGet(handler, `${pathOf(metadata['authorization_endpoint'])}?${query}`, HOST);

    expect(response.status).toBe(302);
    const upstream = new URL(response.headers.get('location') ?? '');
    expect(upstream.host).toBe(providerHost);
    const providerCallback = await httpGet(handler, `${pathOf(upstream.searchParams.get('redirect_uri') ?? '')}`, HOST);
    expect(providerCallback.status).not.toBe(404);
  });
});

describe('splitByApp: an app with local auth signs in through its own endpoints', () => {
  it('serves the sign-in page, takes its form and redeems the code under the app path', async () => {
    const handler = await FrontMcpInstance.createFetchHandler({
      info: { name: 'split-local', version: '1.0.0' },
      apps: [DeskApp, BillingApp],
      splitByApp: true,
      logging: { level: LogLevel.Off },
    });
    const metadata = await discover(handler, 'desk');
    const query = authorizePath({ client_id: 'desk-client', redirect_uri: REDIRECT, state: 's' }).split('?')[1];

    const page = await httpGet(handler, `${pathOf(metadata['authorization_endpoint'])}?${query}`, HOST);
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain('action="/desk/oauth/callback"');

    const callback = await postForm(
      handler,
      '/desk/oauth/callback',
      // What the page's form posts: it lists the app's own sign-in, checked.
      {
        pending_auth_id: inputValue(html, 'pending_auth_id') ?? '',
        federated: 'true',
        providers: '__parent__',
        email: 'ada@example.com',
      },
      HOST,
      { origin: `http://${HOST}` },
    );
    expect(callback.status).toBe(302);
    const tokens = await postForm(
      handler,
      pathOf(metadata['token_endpoint']),
      {
        grant_type: 'authorization_code',
        code: redirectParams(callback).get('code') ?? '',
        client_id: 'desk-client',
        redirect_uri: REDIRECT,
        code_verifier: PKCE_VERIFIER,
      },
      HOST,
    );
    expect(tokens.status).toBe(200);
  });
});
