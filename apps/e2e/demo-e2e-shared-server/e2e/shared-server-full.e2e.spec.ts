/**
 * E2E: a shared local server hosts a whole server (#1349). It serves the config's HTTP routes and people pages, a
 * person signs in with a link a tool hands out; it runs detached jobs in processes of their own; a session that runs
 * the server itself gets its notification stream, channel events included; and a session with a spare boots the
 * server while it attaches, so it serves at once when it falls back.
 */
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';

import type { StdioJsonRpcProcess } from '../../demo-e2e-stdio-transport/e2e/helpers/stdio-json-rpc';
import { ATTACH_TIMEOUT_MS, running, serverPidOf, SharedSessions } from './helpers/shared-sessions';

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** A request to the server on loopback, as a browser sends it. */
function request(port: number, method: string, urlPath: string, headers: Record<string, string> = {}, body?: string) {
  return new Promise<Answer>((resolve, reject) => {
    const sent = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers, agent: false }, (response) => {
      let text = '';
      response.on('data', (chunk: Buffer) => (text += chunk.toString()));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: text }));
    });
    sent.on('error', reject);
    sent.end(body);
  });
}

/** Call `name` with `args` on the session, and answer its structured result. */
async function call(session: StdioJsonRpcProcess, id: number, name: string, args: Record<string, unknown> = {}) {
  const answer = await session.request(
    { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
    ATTACH_TIMEOUT_MS,
  );
  expect(answer.error).toBeUndefined();
  const result = answer.result as { structuredContent?: Record<string, unknown>; isError?: boolean };
  expect(result.isError).toBeFalsy();
  return result.structuredContent ?? {};
}

describe('a shared local server that hosts a whole server', () => {
  let shared: SharedSessions;

  beforeEach(() => {
    shared = new SharedSessions();
  });

  afterEach(async () => {
    await shared.cleanup();
  });

  it('serves its HTTP routes and people pages, and signs a person in with a link a tool hands out', async () => {
    const session = shared.start('http', { SHARED_PAGES: '1' });
    const server = await serverPidOf(session);
    const { port, path: mcpPath } = shared.readRecord();
    if (port === undefined) throw new Error('the record has no port');
    expect(mcpPath).toBe('/mcp');

    const plain = await request(port, 'GET', '/plain');
    expect({ status: plain.status, body: JSON.parse(plain.body) }).toEqual({
      status: 200,
      body: { plain: true, pid: server },
    });
    expect((await request(port, 'GET', '/board')).status).not.toBe(200);

    const { loginPath, url } = (await call(session, 3, 'sign_in_link')) as { loginPath: string; url: string };
    const origin = `http://127.0.0.1:${port}`;
    expect(url).toBe(`${origin}${loginPath}`);
    const page = await request(port, 'GET', loginPath);
    expect(page.status).toBe(200);
    const code = /name="code" value="([^"]+)"/.exec(page.body)?.[1] ?? '';
    const login = await request(
      port,
      'POST',
      '/_frontmcp/people/login',
      { origin, referer: `${origin}${loginPath}`, 'content-type': 'application/x-www-form-urlencoded' },
      new URLSearchParams({ code }).toString(),
    );
    expect(login.status).toBe(200);
    const cookie = String(login.headers['set-cookie']?.[0] ?? '').split(';')[0];

    const board = await request(port, 'GET', '/board', { cookie });
    expect({ status: board.status, body: board.body }).toEqual({ status: 200, body: `board of ${server}` });
    const elsewhere = await request(
      port,
      'POST',
      '/_frontmcp/people/login',
      { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' },
      new URLSearchParams({ code }).toString(),
    );
    expect(elsewhere.status).toBe(403);
  }, 240_000);

  it.each(['unix', 'http'] as const)(
    'runs a detached job in a process of its own, which the server started (%s)',
    async (transport) => {
      const session = shared.start(transport, { SHARED_JOBS: '1' });
      const server = await serverPidOf(session);

      const started = await call(session, 3, 'execute_job', { name: 'runner-pid', input: {} });
      expect(started).toMatchObject({ state: 'pending' });
      const runId = String(started['runId']);
      let status: Record<string, unknown> = {};
      let id = 4;
      await waitUntilAsync(async () => {
        status = await call(session, id++, 'get_job_status', { runId });
        return status['state'] === 'completed' || status['state'] === 'failed';
      }, 'the detached run to end');
      expect(status).toMatchObject({ state: 'completed' });
      const runner = (status['result'] as { pid: number }).pid;
      expect([server, session.pid]).not.toContain(runner);
      expect(running(server)).toBe(true);
    },
    240_000,
  );

  it('sends a session that runs the server itself the notifications of its own server', async () => {
    const first = shared.start('unix');
    const wedged = await serverPidOf(first);
    process.kill(wedged, 'SIGSTOP');
    try {
      const own = shared.start('unix', { SHARED_ATTACH_BUDGET_MS: '3000' });
      expect(await serverPidOf(own)).toBe(own.pid);

      await call(own, 3, 'announce_build', { build: '41' });
      const fromChannel = ({ params }: { params?: Record<string, unknown> }) =>
        (params?.['meta'] as Record<string, unknown> | undefined)?.['source'] === 'build-alerts';
      const event = await own.waitFor(fromChannel, ATTACH_TIMEOUT_MS);
      expect(event.params).toEqual({
        content: `Build 41 finished on server ${own.pid}`,
        meta: { build: '41', source: 'build-alerts' },
      });
    } finally {
      process.kill(wedged, 'SIGCONT');
    }
  }, 240_000);

  it('boots a spare while it attaches, and serves from it once it falls back', async () => {
    const boots = path.join(shared.home, 'boots');
    const first = shared.start('unix', { SHARED_BOOTS: boots });
    const wedged = await serverPidOf(first);
    process.kill(wedged, 'SIGSTOP');
    try {
      const budgetMs = 6_000;
      const own = shared.start('unix', {
        SHARED_BOOTS: boots,
        SHARED_SPARE: '1',
        SHARED_BOOT_DELAY_MS: '3000',
        SHARED_ATTACH_BUDGET_MS: String(budgetMs),
      });
      // When the session fell back: its attach budget after it began to attach
      const fellBackAt = waitUntilAsync(
        async () => own.stderrLines.some((line) => line.includes('in this process')),
        'the session to fall back',
        50,
      ).then(() => Date.now());
      expect(await serverPidOf(own)).toBe(own.pid);
      const fallback = own.stderrLines.find((line) => line.includes('in this process'));
      expect(fallback).toMatch(/^\[frontmcp shared\] warn running the shared server "e2e" in this process: /);

      const bootsOf = (pid: number | undefined) =>
        fs
          .readFileSync(boots, 'utf8')
          .split('\n')
          .filter((line) => line.startsWith(`${pid} `))
          .map((line) => Number(line.split(' ')[1]));
      // One boot, begun as the session began to attach, long before its attach budget ran out
      const [bootedAt, ...more] = bootsOf(own.pid);
      expect(more).toEqual([]);
      expect((await fellBackAt) - bootedAt).toBeGreaterThan(budgetMs / 2);
    } finally {
      process.kill(wedged, 'SIGCONT');
    }
  }, 240_000);
});

async function waitUntilAsync(
  condition: () => Promise<boolean>,
  what: string,
  intervalMs = 250,
  timeoutMs = 90_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
