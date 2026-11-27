/**
 * People sessions outlive a restart when the server has a store (#1355): a browser signed in before the server
 * restarts opens a people page after it, without signing in again.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { expect, TestServer } from '@frontmcp/testing';

// Run from the app directory, whose tsconfig resolves @frontmcp/sdk to its source rather than a build.
const SERVER = { command: 'npx tsx src/main.kept-sessions.ts', cwd: path.join(__dirname, '..') };
const TOKEN_LINE = /people sign-in token: ([A-Za-z0-9_-]{43})/;

function startupToken(server: TestServer): string {
  const line = server.getLogs().find((entry) => TOKEN_LINE.test(entry));
  if (!line) throw new Error('the server printed no sign-in token');
  return (TOKEN_LINE.exec(line) as RegExpExecArray)[1];
}

async function signIn(server: TestServer): Promise<string> {
  const { baseUrl } = server.info;
  const issued = await fetch(`${baseUrl}/_frontmcp/people/code`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${startupToken(server)}` },
  });
  const { code } = (await issued.json()) as { code: string };
  const login = await fetch(`${baseUrl}/_frontmcp/people/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: baseUrl },
    body: new URLSearchParams({ code }).toString(),
    redirect: 'manual',
  });
  expect(login.status).toBe(200);
  return (login.headers.get('set-cookie') ?? '').split(';')[0];
}

describe('People sessions across a restart', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'web-host-sessions-'));
  const env = { PEOPLE_SQLITE: path.join(dir, 'people.sqlite') };
  let server: TestServer | undefined;

  afterAll(async () => {
    await server?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('keep a browser signed in after the server restarts on its sqlite store', async () => {
    server = await TestServer.start({ ...SERVER, env, project: 'demo-e2e-web-host', startupTimeout: 60_000 });
    const cookie = await signIn(server);
    expect((await fetch(`${server.info.baseUrl}/board`, { headers: { Cookie: cookie } })).status).toBe(200);

    const { port } = server.info;
    await server.stop();
    server = await TestServer.start({ ...SERVER, env, port, project: 'demo-e2e-web-host', startupTimeout: 60_000 });

    expect((await fetch(`${server.info.baseUrl}/board`, { headers: { Cookie: cookie } })).status).toBe(200);
    expect(
      (await fetch(`${server.info.baseUrl}/board`, { headers: { Cookie: 'frontmcp_people=forged' } })).status,
    ).toBe(401);
  }, 180_000);
});
