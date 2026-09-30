/**
 * The built @frontmcp/testing package can be loaded and used from a plain Node process, outside
 * Jest (issue #644): token factory, mock OAuth server and TestServer no longer pull in
 * `@jest/globals` at import time, and the placeholder `playwright` entry says so clearly.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../../..');
const dist = join(root, 'libs/testing/dist');

function runNode(script: string) {
  return spawnSync(process.execPath, ['-e', script], { cwd: root, encoding: 'utf8', timeout: 60000 });
}

describe('@frontmcp/testing outside Jest', () => {
  beforeAll(() => {
    if (!existsSync(join(dist, 'index.js'))) {
      throw new Error('libs/testing/dist is missing; run `nx build testing` (the test target depends on it)');
    }
  });

  it('loads and signs a token without Jest', () => {
    const result = runNode(`
      const { TestTokenFactory } = require(${JSON.stringify(join(dist, 'index.js'))});
      new TestTokenFactory().createTestToken({ sub: 'plain-node' }).then((t) => {
        console.log('OK:' + t.split('.').length);
      });
    `);
    expect(result.stderr).not.toMatch(/jest/i);
    expect(result.stdout.trim()).toBe('OK:3');
    expect(result.status).toBe(0);
  });

  it('runs the mock OAuth server code exchange without --experimental-vm-modules', () => {
    const result = runNode(`
      const { MockOAuthServer, TestTokenFactory } = require(${JSON.stringify(join(dist, 'index.js'))});
      (async () => {
        const server = new MockOAuthServer(new TestTokenFactory(), {
          autoApprove: true, testUser: { sub: 'u', email: 'u@example.com', name: 'U' }, clientId: 'c', validRedirectUris: ['http://localhost:1/cb'], accessTokenTtlSeconds: 60,
        });
        const info = await server.start();
        const u = new URL(info.baseUrl + '/oauth/authorize');
        u.searchParams.set('client_id', 'c'); u.searchParams.set('redirect_uri', 'http://localhost:1/cb');
        u.searchParams.set('response_type', 'code'); u.searchParams.set('scope', 'a b');
        const r = await fetch(u, { redirect: 'manual' });
        const code = new URL(r.headers.get('location')).searchParams.get('code');
        const t = await fetch(info.baseUrl + '/oauth/token', { method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: 'http://localhost:1/cb', client_id: 'c' }) });
        const body = await t.json();
        const payload = JSON.parse(Buffer.from(body.access_token.split('.')[1], 'base64url').toString());
        await server.stop();
        console.log('SCOPE:' + payload.scope + ' TTL:' + (payload.exp - payload.iat));
      })().catch((e) => { console.error(e); process.exit(1); });
    `);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/SCOPE:a b TTL:6[01]/);
  });

  it('the playwright entry is importable and explains that it is not implemented', () => {
    const result = runNode(`
      const pw = require(${JSON.stringify(join(dist, 'playwright/index.js'))});
      try { pw.test('x', async () => {}); } catch (e) { console.log(e.message); }
      console.log(pw.playwrightIntegration.status);
    `);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/not yet implemented/);
    expect(result.stdout).toMatch(/planned/);
  });
});
