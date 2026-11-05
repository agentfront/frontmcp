import { signCredentialResumeToken } from '@frontmcp/auth';
import { expect, McpTestClient, TestServer } from '@frontmcp/testing';

import { browserFetch } from './browser-fetch';
import { signInWithApiKey } from './sign-in';

const SERVER_ENTRY = 'apps/e2e/demo-e2e-local-auth/src/main.credentials.ts';
const PORT = '53591';
const JWT_SECRET = 'connect-without-vault-e2e-jwt-secret-32b';
const CLIENT_ID = 'local-connect-without-vault-client';
const REDIRECT_URI = 'http://127.0.0.1:9880/callback';
const CONNECT_API_KEY = 'sk-test-credentials-secret';

interface CredentialGateErrorData {
  providers?: string[];
  authUrl?: string;
}

function startServer(): Promise<TestServer> {
  return TestServer.start({
    command: `npx tsx ${SERVER_ENTRY}`,
    project: 'demo-e2e-local-auth',
    port: Number(PORT),
    startupTimeout: 60000,
    debug: process.env['DEBUG'] === '1',
    env: { PORT, JWT_SECRET },
  });
}

function signIn(baseUrl: string, apiKey: string): Promise<string> {
  return signInWithApiKey(baseUrl, { clientId: CLIENT_ID, redirectUri: REDIRECT_URI, apiKey });
}

async function withClient<T>(baseUrl: string, token: string, run: (client: McpTestClient) => Promise<T>): Promise<T> {
  const client = await McpTestClient.create({
    baseUrl,
    transport: 'streamable-http',
    auth: { token },
  }).buildAndConnect();
  try {
    return await run(client);
  } finally {
    await client.disconnect();
  }
}

async function connectUrlOfGatedCall(client: McpTestClient, toolName: string): Promise<string> {
  const result = await client.tools.call(toolName, {});
  expect(result.isError).toBe(true);
  expect(result.error?.code).toBe(-32001);
  const data = result.error?.data as CredentialGateErrorData | undefined;
  expect(data?.authUrl).toContain('/oauth/connect?token=');
  return data?.authUrl ?? '';
}

function submitConnect(baseUrl: string, connectUrl: string): Promise<Response> {
  const connectToken = new URL(connectUrl).searchParams.get('token') ?? '';
  return browserFetch(`${baseUrl}/oauth/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: connectToken, apiKey: CONNECT_API_KEY }).toString(),
    redirect: 'manual',
  });
}

describe('LOCAL-mode connect for a signed-in caller with no credential vault yet', () => {
  let server: TestServer;
  let baseUrl: string;

  beforeAll(async () => {
    server = await startServer();
    baseUrl = server.info.baseUrl;
  }, 90000);

  afterAll(async () => {
    if (server) await server.stop();
  });

  it('connects a credential for a caller whose sign-in stored none, and the gated tool then runs', async () => {
    const token = await signIn(baseUrl, 'sk-test-no-credential-first-caller');

    await withClient(baseUrl, token, async (client) => {
      const connectUrl = await connectUrlOfGatedCall(client, 'gated-globex');

      const submit = await submitConnect(baseUrl, connectUrl);
      expect(submit.status).toBe(200);
      expect(await submit.text()).toContain('connected');

      const after = await client.tools.call('gated-globex', {});
      expect(after.isError).toBe(false);
      expect(after.json<{ ok: boolean; provider: string }>()).toEqual({ ok: true, provider: 'globex' });
    });
  });

  it('a new sign-in starts with an empty vault again', async () => {
    const apiKey = 'sk-test-no-credential-second-caller';
    const firstToken = await signIn(baseUrl, apiKey);
    await withClient(baseUrl, firstToken, async (client) => {
      const submit = await submitConnect(baseUrl, await connectUrlOfGatedCall(client, 'gated-globex'));
      expect(submit.status).toBe(200);
      expect((await client.tools.call('gated-globex', {})).isError).toBe(false);
    });

    const secondToken = await signIn(baseUrl, apiKey);
    await withClient(baseUrl, secondToken, async (client) => {
      await connectUrlOfGatedCall(client, 'gated-globex');
    });
  });

  it('refuses a connect link signed for an anonymous caller, and says to sign in', async () => {
    const anonymousLink = `${baseUrl}/oauth/connect?token=${encodeURIComponent(
      signCredentialResumeToken({ sub: '', key: 'globex' }, JWT_SECRET),
    )}`;

    const page = await browserFetch(anonymousLink, { method: 'GET', redirect: 'manual' });
    const submit = await submitConnect(baseUrl, anonymousLink);

    for (const response of [page, submit]) {
      expect(response.status).toBe(403);
      const html = await response.text();
      expect(html).toContain('login_required');
      expect(html).toContain('Sign in to this server');
      expect(html).not.toContain('name="token"');
    }
  });

  it('after a restart drops the in-memory vault, the same signed-in caller connects again', async () => {
    const token = await signIn(baseUrl, CONNECT_API_KEY);
    await withClient(baseUrl, token, async (client) => {
      expect((await client.tools.call('gated-acme', {})).isError).toBe(false);
    });

    await server.stop();
    server = await startServer();

    await withClient(baseUrl, token, async (client) => {
      const submit = await submitConnect(baseUrl, await connectUrlOfGatedCall(client, 'gated-acme'));
      expect(submit.status).toBe(200);
      expect((await client.tools.call('gated-acme', {})).isError).toBe(false);
    });
  }, 120000);
});
