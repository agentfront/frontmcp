/**
 * Persistent questions (`elicitation.persistent`): a tool asks with `persist`, the question stays for the signed-in
 * caller after its call stops waiting, a person signed in for that caller answers it in the inbox (the people routes,
 * or `frontmcp inbox`), and the answer reaches the waiting call, or the next call of the same user after a reconnect,
 * once. No one else sees or answers it.
 */
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { expect, McpTestClient, MockOAuthServer, TestServer, TestTokenFactory } from '@frontmcp/testing';
import { mkdtemp, rm } from '@frontmcp/utils';

const SERVER_ENTRY = 'apps/e2e/demo-e2e-elicitation/src/main.questions.ts';
const CLI = resolve(__dirname, '../../../../libs/cli/dist/src/core/cli.js');
const run = promisify(execFile);
const INBOX_LINK = /question inbox sign-in link: (\S+)/;

interface InboxQuestion {
  id: string;
  key: string;
  message: string;
  answered: boolean;
}

describe('Persistent questions E2E', () => {
  let home: string;
  let mockOAuth: MockOAuthServer;
  let tokenFactory: TestTokenFactory;
  let server: TestServer;
  const clients: McpTestClient[] = [];

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'frontmcp-questions-'));
    tokenFactory = new TestTokenFactory({ issuer: 'http://localhost', audience: 'frontmcp-test' });
    mockOAuth = new MockOAuthServer(tokenFactory, { debug: false });
    const probe = await mockOAuth.start();
    await mockOAuth.stop();
    tokenFactory = new TestTokenFactory({ issuer: probe.issuer, audience: probe.issuer });
    mockOAuth = new MockOAuthServer(tokenFactory, { debug: false, port: probe.port });
    const idp = await mockOAuth.start();

    server = await TestServer.start({
      command: `npx tsx ${SERVER_ENTRY}`,
      project: 'demo-e2e-elicitation',
      env: { IDP_PROVIDER_URL: idp.baseUrl, IDP_EXPECTED_AUDIENCE: idp.issuer, FRONTMCP_HOME: home },
      startupTimeout: 90_000,
      debug: process.env['DEBUG'] === '1',
    });
  }, 120_000);

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.disconnect().catch(() => undefined)));
    if (server) await server.stop();
    if (mockOAuth) await mockOAuth.stop();
    if (home) await rm(home, { recursive: true, force: true });
  });

  async function connect(sub: string): Promise<McpTestClient> {
    const token = await tokenFactory.createTestToken({ sub });
    const client = await McpTestClient.create({
      baseUrl: server.info.baseUrl,
      transport: 'streamable-http',
      auth: { token },
    }).buildAndConnect();
    clients.push(client);
    return client;
  }

  /** Have the caller print an inbox link on the server console, and read it there as the person at the machine does. */
  async function inboxLink(mcp: McpTestClient): Promise<string> {
    const printedBefore = server.getLogs().length;
    const result = await mcp.tools.call('inbox-link', {});
    expect(result).toBeSuccessful();
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const line = server
        .getLogs()
        .slice(printedBefore)
        .find((entry) => INBOX_LINK.test(entry));
      if (line) {
        const link = (INBOX_LINK.exec(line) as RegExpExecArray)[1];
        expect(JSON.stringify(result)).not.toContain(new URL(link, server.info.baseUrl).searchParams.get('code'));
        return new URL(link, server.info.baseUrl).toString();
      }
      await new Promise((settle) => setTimeout(settle, 50));
    }
    throw new Error('the server printed no inbox link');
  }

  /** Sign a person in with the caller's inbox link, as the inbox page does, and return their session cookie. */
  async function signIn(mcp: McpTestClient): Promise<string> {
    const code = new URL(await inboxLink(mcp)).searchParams.get('code') ?? '';
    const response = await fetch(`${server.info.baseUrl}/_frontmcp/people/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: server.info.baseUrl },
      body: new URLSearchParams({ code }).toString(),
      redirect: 'manual',
    });
    expect(response.status).toBe(200);
    return (response.headers.get('set-cookie') ?? '').split(';')[0];
  }

  async function inbox(cookie: string): Promise<InboxQuestion[]> {
    const response = await fetch(`${server.info.baseUrl}/_frontmcp/questions`, { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    return ((await response.json()) as { questions: InboxQuestion[] }).questions;
  }

  /** The question once the inbox shows it, waiting generously for a loaded machine. */
  async function waitForQuestion(cookie: string, key: string, timeoutMs = 30_000): Promise<InboxQuestion> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const question = (await inbox(cookie)).find((candidate) => candidate.key === key && !candidate.answered);
      if (question) return question;
      await new Promise((settle) => setTimeout(settle, 100));
    }
    throw new Error(`the question "${key}" never reached the inbox`);
  }

  function answer(cookie: string, id: string, body: unknown, origin = server.info.baseUrl): Promise<Response> {
    return fetch(`${server.info.baseUrl}/_frontmcp/questions/${id}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: origin },
      body: JSON.stringify(body),
    });
  }

  it('hands the waiting call the answer a person gives in the inbox', async () => {
    const alice = await connect('alice');
    const cookie = await signIn(alice);

    const call = alice.tools.call('approve-deploy', { version: '1.0.0' });
    const question = await waitForQuestion(cookie, 'deploy-1.0.0');
    expect(question.message).toBe('Deploy 1.0.0 to production?');
    expect((await answer(cookie, question.id, { action: 'accept', content: { approve: true } })).status).toBe(200);

    const result = await call;
    expect(result).toBeSuccessful();
    expect(result.text()).toContain('Deploy 1.0.0 approved');
  });

  it('asks, disconnects, is answered in the inbox, and the call after the reconnect gets the answer once', async () => {
    const first = await connect('alice');
    const cookie = await signIn(first);

    const gaveUp = await first.tools.call('approve-deploy', { version: '2.0.0', waitMs: 1_500 });
    expect(gaveUp.isError).toBe(true);
    expect(gaveUp.text()).toContain('has no answer yet');
    await first.disconnect();

    const question = await waitForQuestion(cookie, 'deploy-2.0.0');
    expect((await answer(cookie, question.id, { action: 'accept', content: { approve: true } })).status).toBe(200);

    const second = await connect('alice');
    const delivered = await second.tools.call('approve-deploy', { version: '2.0.0', waitMs: 1_500 });
    expect(delivered).toBeSuccessful();
    expect(delivered.text()).toContain('Deploy 2.0.0 approved');

    const again = await second.tools.call('approve-deploy', { version: '2.0.0', waitMs: 1_500 });
    expect(again.isError).toBe(true);
    expect(again.text()).toContain('has no answer yet');
  });

  it('keeps an answer for the next session when the waiting session ends', async () => {
    const first = await connect('alice');
    const cookie = await signIn(first);

    void first.tools.call('approve-deploy', { version: '3.0.0' }).catch(() => undefined);
    const question = await waitForQuestion(cookie, 'deploy-3.0.0');
    const ended = await fetch(new URL('/', server.info.baseUrl), {
      method: 'DELETE',
      headers: {
        'mcp-session-id': first.sessionId,
        Authorization: `Bearer ${await tokenFactory.createTestToken({ sub: 'alice' })}`,
      },
    });
    expect(ended.status).toBeLessThan(300);
    expect((await answer(cookie, question.id, { action: 'accept', content: { approve: true } })).status).toBe(200);

    const second = await connect('alice');
    const delivered = await second.tools.call('approve-deploy', { version: '3.0.0', waitMs: 1_500 });
    expect(delivered).toBeSuccessful();
    expect(delivered.text()).toContain('Deploy 3.0.0 approved');
  });

  it('shows the question to no other subject, and lets no one else answer it', async () => {
    const alice = await connect('alice');
    const aliceCookie = await signIn(alice);
    const asked = await alice.tools.call('approve-deploy', { version: '4.0.0', waitMs: 1_500 });
    expect(asked.isError).toBe(true);
    const question = await waitForQuestion(aliceCookie, 'deploy-4.0.0');

    const bob = await connect('bob');
    const bobCookie = await signIn(bob);
    expect((await inbox(bobCookie)).map((candidate) => candidate.id)).not.toContain(question.id);
    expect((await answer(bobCookie, question.id, { action: 'accept', content: { approve: true } })).status).toBe(404);

    const bobsCall = await bob.tools.call('approve-deploy', { version: '4.0.0', waitMs: 1_500 });
    expect(bobsCall.isError).toBe(true);
    expect((await inbox(aliceCookie)).find((candidate) => candidate.id === question.id)?.answered).toBe(false);
  });

  it("opens no inbox for a person signed in with the startup token's code", async () => {
    const token = /people sign-in token: (\S+)/.exec(server.getLogs().join('\n'))?.[1] ?? '';
    const issued = await fetch(`${server.info.baseUrl}/_frontmcp/people/code`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(issued.status).toBe(200);
    const { code } = (await issued.json()) as { code: string };
    const login = await fetch(`${server.info.baseUrl}/_frontmcp/people/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: server.info.baseUrl },
      body: new URLSearchParams({ code }).toString(),
      redirect: 'manual',
    });
    const operator = (login.headers.get('set-cookie') ?? '').split(';')[0];

    const listed = await fetch(`${server.info.baseUrl}/_frontmcp/questions`, { headers: { Cookie: operator } });

    expect(operator).toMatch(/^frontmcp_people=/);
    expect(listed.status).toBe(401);
  });

  it('refuses an answer posted from another site', async () => {
    const alice = await connect('alice');
    const cookie = await signIn(alice);
    await alice.tools.call('approve-deploy', { version: '5.0.0', waitMs: 1_500 });
    const question = await waitForQuestion(cookie, 'deploy-5.0.0');

    const crossSite = await answer(cookie, question.id, { action: 'decline' }, 'https://evil.example');

    expect(crossSite.status).toBe(403);
    expect((await inbox(cookie)).find((candidate) => candidate.id === question.id)?.answered).toBe(false);
  });

  it('answers with frontmcp inbox, which signs in with the same one-time link', async () => {
    const alice = await connect('alice');
    await alice.tools.call('approve-deploy', { version: '6.0.0', waitMs: 1_500 });
    const cookie = await signIn(alice);
    const question = await waitForQuestion(cookie, 'deploy-6.0.0');

    const piped = run('node', [CLI, 'inbox'], { timeout: 60_000 });
    piped.child.stdin?.end(`${await inboxLink(alice)}\n`);
    const listed = await piped;
    expect(listed.stdout).toContain('Deploy 6.0.0 to production?');
    expect(listed.stdout).toContain(question.id);

    const link = await inboxLink(alice);
    await run('node', [CLI, 'inbox', '--answer', question.id, '--content', '{"approve":true}'], {
      timeout: 60_000,
      env: { ...process.env, FRONTMCP_INBOX_LINK: link },
    });
    const reused = await run('node', [CLI, 'inbox', link], { timeout: 60_000 }).catch(
      (error: { stderr?: string }) => error,
    );
    expect(String((reused as { stderr?: string }).stderr)).toContain('Sign-in refused (401)');

    const delivered = await alice.tools.call('approve-deploy', { version: '6.0.0', waitMs: 1_500 });
    expect(delivered.text()).toContain('Deploy 6.0.0 approved');
  });
});
