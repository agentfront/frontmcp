/**
 * What a caller missing a credential sees (-32001), over real sessions against the `auth.mode: 'local'` credentials
 * server (main.credentials.ts), where `gated-globex` needs a `globex` credential no sign-in stores:
 *   - the connect link is in the error's data, never its message;
 *   - a client that declared URL-mode elicitation is asked to open the link, and the call runs once it's connected;
 *   - an anonymous caller is told to sign in, with no link (none works before sign-in).
 */
import { expect, McpTestClient, TestServer } from '@frontmcp/testing';

import { browserFetch } from './browser-fetch';
import { signInWithApiKey } from './sign-in';

const SERVER_ENTRY = 'apps/e2e/demo-e2e-local-auth/src/main.credentials.ts';
const CLIENT_ID = 'local-credentials-required-client';
const REDIRECT_URI = 'http://127.0.0.1:9881/callback';
const API_KEY = 'sk-test-credentials-secret';

interface AskedElicitation {
  mode: string;
  message: string;
  url?: string;
}

interface CredentialsRequiredData {
  tool?: string;
  providers?: string[];
  authUrl?: string;
  signInRequired?: boolean;
}

async function connectThroughPage(baseUrl: string, connectUrl: string): Promise<void> {
  const connectToken = new URL(connectUrl).searchParams.get('token') ?? '';
  const submit = await browserFetch(`${baseUrl}/oauth/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: connectToken, apiKey: API_KEY }).toString(),
    redirect: 'manual',
  });
  expect(submit.status).toBe(200);
}

async function anonymousToken(baseUrl: string): Promise<string> {
  const response = await browserFetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'anonymous', client_id: CLIENT_ID }).toString(),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { access_token: string }).access_token;
}

describe('LOCAL-mode credentials-required answer', () => {
  let server: TestServer;
  let baseUrl: string;

  beforeAll(async () => {
    server = await TestServer.start({
      command: `npx tsx ${SERVER_ENTRY}`,
      project: 'demo-e2e-local-auth',
      startupTimeout: 60000,
      debug: process.env['DEBUG'] === '1',
      env: { ALLOW_ANONYMOUS: 'true' },
    });
    baseUrl = server.info.baseUrl;
  }, 90000);

  afterAll(async () => {
    if (server) await server.stop();
  });

  async function signedInClient(capabilities?: Record<string, unknown>): Promise<McpTestClient> {
    const token = await signInWithApiKey(baseUrl, { clientId: CLIENT_ID, redirectUri: REDIRECT_URI, apiKey: API_KEY });
    const builder = McpTestClient.create({ baseUrl, transport: 'streamable-http', auth: { token } });
    return (capabilities ? builder.withCapabilities(capabilities) : builder).buildAndConnect();
  }

  it('names the provider in the message and keeps the connect link in the data', async () => {
    const client = await signedInClient();
    try {
      const result = await client.tools.call('gated-globex', {});

      expect(result.error?.code).toBe(-32001);
      expect(result.error?.message).toContain(
        "Connect globex to continue: open the link in this error's data (authUrl).",
      );
      expect(result.error?.message).not.toContain('/oauth/connect');
      const data = result.error?.data as CredentialsRequiredData | undefined;
      expect(data?.providers).toEqual(['globex']);
      expect(data?.authUrl).toContain('/oauth/connect?token=');
      expect(data?.signInRequired).toBeUndefined();
    } finally {
      await client.disconnect();
    }
  });

  it('asks a client that declared URL-mode elicitation to open the connect page, then runs the call', async () => {
    const client = await signedInClient({ elicitation: { form: {}, url: {} } });
    const asked: AskedElicitation[] = [];
    client.onElicitation(async (request) => {
      asked.push(request);
      await connectThroughPage(baseUrl, request.url ?? '');
      return { action: 'accept' };
    });
    try {
      const result = await client.tools.call('gated-globex', {});

      expect(result.isError).toBe(false);
      expect(result.json<{ ok: boolean; provider: string }>()).toEqual({ ok: true, provider: 'globex' });
      expect(asked).toEqual([
        expect.objectContaining({
          mode: 'url',
          message: 'Connect globex to continue: tool "Credentials:gated-globex" needs it.',
          url: expect.stringContaining('/oauth/connect?token='),
          elicitationId: expect.any(String),
        }),
      ]);
    } finally {
      await client.disconnect();
    }
  });

  it('answers -32001, with the link in the data, when the user declines the connect page', async () => {
    const client = await signedInClient({ elicitation: { form: {}, url: {} } });
    client.onElicitation(async () => ({ action: 'decline' }));
    try {
      const result = await client.tools.call('gated-globex', {});

      expect(result.error?.code).toBe(-32001);
      expect(result.error?.message).not.toContain('/oauth/connect');
      expect((result.error?.data as CredentialsRequiredData | undefined)?.authUrl).toContain('/oauth/connect?token=');
    } finally {
      await client.disconnect();
    }
  });

  it('tells an anonymous caller to sign in, with no connect link', async () => {
    const client = await McpTestClient.create({
      baseUrl,
      transport: 'streamable-http',
      auth: { token: await anonymousToken(baseUrl) },
    })
      .withCapabilities({ elicitation: { form: {}, url: {} } })
      .buildAndConnect();
    const asked: AskedElicitation[] = [];
    client.onElicitation(async (request) => {
      asked.push(request);
      return { action: 'accept' };
    });
    try {
      const result = await client.tools.call('gated-globex', {});

      expect(result.error?.code).toBe(-32001);
      expect(result.error?.message).toContain(
        'Tool "Credentials:gated-globex" requires credentials for globex, and this caller isn\'t signed in. ' +
          'Sign in to this server, then connect globex.',
      );
      const data = result.error?.data as CredentialsRequiredData | undefined;
      expect(data).toEqual(
        expect.objectContaining({ tool: 'Credentials:gated-globex', providers: ['globex'], signInRequired: true }),
      );
      expect(data?.authUrl).toBeUndefined();
      expect(asked).toEqual([]);
    } finally {
      await client.disconnect();
    }
  });
});
