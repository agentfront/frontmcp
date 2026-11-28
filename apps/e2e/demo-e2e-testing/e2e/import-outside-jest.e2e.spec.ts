/**
 * The built @frontmcp/testing package can be loaded and used from a plain Node process, outside
 * Jest (issue #644): token factory, mock OAuth server and TestServer no longer pull in
 * `@jest/globals` at import time, and the placeholder `playwright` entry says so clearly. The mock provider
 * also loads from `@frontmcp/auth/testing` alone (issue #1365).
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
      const { generatePkcePair } = require('@frontmcp/utils');
      (async () => {
        const server = new MockOAuthServer(new TestTokenFactory(), {
          autoApprove: true, testUser: { sub: 'u', email: 'u@example.com', name: 'U' }, clientId: 'c', validRedirectUris: ['http://localhost:1/cb'], accessTokenTtlSeconds: 60,
        });
        const info = await server.start();
        // The mock requires S256 PKCE by default.
        const { codeVerifier, codeChallenge } = generatePkcePair();
        const u = new URL(info.baseUrl + '/oauth/authorize');
        u.searchParams.set('client_id', 'c'); u.searchParams.set('redirect_uri', 'http://localhost:1/cb');
        u.searchParams.set('response_type', 'code'); u.searchParams.set('scope', 'a b');
        u.searchParams.set('code_challenge', codeChallenge); u.searchParams.set('code_challenge_method', 'S256');
        const r = await fetch(u, { redirect: 'manual' });
        const code = new URL(r.headers.get('location')).searchParams.get('code');
        const t = await fetch(info.baseUrl + '/oauth/token', { method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: 'http://localhost:1/cb', client_id: 'c', code_verifier: codeVerifier }) });
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
      for (const use of [() => pw.test('x', async () => {}), () => pw.test.describe('x', () => {}), () => pw.expect(1)]) {
        try { use(); } catch (e) { console.log(e.message); }
      }
      console.log(pw.playwrightIntegration.status);
    `);
    expect(result.status).toBe(0);
    const messages = result.stdout.trim().split('\n');
    expect(messages.slice(0, 3)).toEqual(
      Array(3).fill(
        expect.stringMatching(/^@frontmcp\/testing\/playwright is not implemented\. .*`@playwright\/test`/),
      ),
    );
    expect(messages[3]).toBe('planned');
  });

  // #1365: the mock provider from @frontmcp/auth, without @frontmcp/testing, the SDK, SWC or Jest
  it('runs the mock OAuth server from @frontmcp/auth/testing alone, with strict PKCE by default', () => {
    const authTesting = join(root, 'libs/auth/dist/testing/index.js');
    const result = runNode(`
      const { MockOAuthServer, TestTokenFactory } = require(${JSON.stringify(authTesting)});
      const { generatePkcePair } = require('@frontmcp/utils');
      (async () => {
        const server = new MockOAuthServer(new TestTokenFactory(), {
          autoApprove: true, testUser: { sub: 'u' }, clientId: 'c', validRedirectUris: ['http://127.0.0.1:1/cb'],
        });
        const info = await server.start();
        const authorize = async (extra) => {
          const u = new URL(info.baseUrl + '/oauth/authorize');
          for (const [k, v] of Object.entries({ client_id: 'c', redirect_uri: 'http://127.0.0.1:1/cb', response_type: 'code', ...extra })) u.searchParams.set(k, v);
          const r = await fetch(u, { redirect: 'manual' });
          return new URL(r.headers.get('location')).searchParams;
        };
        const refused = await authorize({});
        const { codeVerifier, codeChallenge } = generatePkcePair();
        const code = (await authorize({ code_challenge: codeChallenge, code_challenge_method: 'S256' })).get('code');
        const t = await fetch(info.baseUrl + '/oauth/token', { method: 'POST',
          body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: 'http://127.0.0.1:1/cb', client_id: 'c', code_verifier: codeVerifier }) });
        await server.stop();
        const heavy = Object.keys(require.cache).filter((p) => ['@swc', 'jest', 'libs/sdk', 'libs/testing'].some((n) => p.includes(n)));
        console.log('REFUSED:' + refused.get('error') + ' TOKEN:' + t.status + ' HEAVY:' + heavy.length);
      })().catch((e) => { console.error(e); process.exit(1); });
    `);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('REFUSED:invalid_request TOKEN:200 HEAVY:0');
  });

  it('exports the same MockOAuthServer and TestTokenFactory from @frontmcp/testing', () => {
    const result = runNode(`
      const testing = require(${JSON.stringify(join(dist, 'index.js'))});
      const auth = require(${JSON.stringify(join(root, 'libs/auth/dist/testing/index.js'))});
      console.log('SAME:' + (testing.MockOAuthServer === auth.MockOAuthServer && testing.TestTokenFactory === auth.TestTokenFactory));
    `);
    expect(result.stdout.trim()).toBe('SAME:true');
  });
});
