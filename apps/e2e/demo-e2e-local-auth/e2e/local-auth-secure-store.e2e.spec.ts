/**
 * E2E tests for the general session secure-secret store (#470) — `this.secureStore`.
 *
 * Drives the full OAuth 2.1 authorization-code + PKCE flow over real HTTP against
 * a `auth.mode: 'local'` server, then exercises the secure store over a real
 * authenticated MCP session against TWO backings:
 *
 *   - MEMORY backing: set → get → list → delete round-trip within one session.
 *   - SQLITE backing: a secret written in ONE session is readable in a SECOND
 *     session for the SAME operator (proves persistent, user-scoped storage),
 *     and survives across the two sessions.
 *
 * The fixture's `secret` tool never returns the raw secret — only `[redacted]` +
 * presence — so behavior is asserted without leaking the secret. Secrets are
 * synthetic (no PII).
 */
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, McpTestClient, TestServer } from '@frontmcp/testing';
import { generateCodeVerifier, sha256Base64url } from '@frontmcp/utils';

const SERVER_ENTRY = 'apps/e2e/demo-e2e-local-auth/src/main.secure-store.ts';

const REDIRECT_URI = 'http://127.0.0.1:9879/callback';
const CLIENT_ID = 'local-secure-store-client';
const GOOD_API_KEY = 'sk-test-secure-store-secret';
// Fixed secrets so persistence/derivation is deterministic across sessions.
const JWT_SECRET = 'secure-store-e2e-jwt-secret-32-bytes-min';
const VAULT_SECRET = 'secure-store-e2e-vault-secret-32-bytes';

interface PkcePair {
  verifier: string;
  challenge: string;
}

function makePkce(): PkcePair {
  const verifier = generateCodeVerifier();
  return { verifier, challenge: sha256Base64url(verifier) };
}

function buildAuthorizeUrl(baseUrl: string, challenge: string, scope?: string): string {
  const url = new URL(`${baseUrl}/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (scope) url.searchParams.set('scope', scope);
  return url.toString();
}

async function startAuthorization(baseUrl: string, challenge: string, scope?: string) {
  const res = await fetch(buildAuthorizeUrl(baseUrl, challenge, scope), { method: 'GET', redirect: 'manual' });
  expect(res.status).toBe(200);
  const html = await res.text();
  const match = html.match(/name="pending_auth_id"\s+value="([^"]+)"/);
  expect(match).toBeTruthy();
  return match![1];
}

async function submitLogin(baseUrl: string, pendingAuthId: string, apiKey: string): Promise<Response> {
  const url = new URL(`${baseUrl}/oauth/callback`);
  url.searchParams.set('pending_auth_id', pendingAuthId);
  url.searchParams.set('apiKey', apiKey);
  return fetch(url.toString(), { method: 'GET', redirect: 'manual' });
}

async function exchangeToken(baseUrl: string, code: string, verifier: string): Promise<string> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  });
  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

/** Full login → token helper (stable per-account sub for the fixed apiKey). */
async function login(baseUrl: string): Promise<string> {
  const { verifier, challenge } = makePkce();
  const pendingAuthId = await startAuthorization(baseUrl, challenge, 'read write');
  const res = await submitLogin(baseUrl, pendingAuthId, GOOD_API_KEY);
  expect([302, 303]).toContain(res.status);
  const code = new URL(res.headers.get('location')!).searchParams.get('code')!;
  return exchangeToken(baseUrl, code, verifier);
}

interface SecretOutput {
  op: string;
  present?: boolean;
  preview?: string;
  keys?: string[];
}

async function withSession<T>(baseUrl: string, fn: (client: McpTestClient) => Promise<T>): Promise<T> {
  const token = await login(baseUrl);
  const client = await McpTestClient.create({
    baseUrl,
    transport: 'streamable-http',
    auth: { token },
  }).buildAndConnect();
  try {
    return await fn(client);
  } finally {
    await client.disconnect();
  }
}

describe('LOCAL-mode session secure-secret store E2E (#470)', () => {
  describe('memory backing', () => {
    let server: TestServer;
    let baseUrl: string;

    beforeAll(async () => {
      server = await TestServer.start({
        command: `npx tsx ${SERVER_ENTRY}`,
        project: 'demo-e2e-local-auth',
        startupTimeout: 60000,
        debug: process.env['DEBUG'] === '1',
        env: { SECURE_STORE_BACKING: 'memory', JWT_SECRET, VAULT_SECRET },
      });
      baseUrl = server.info.baseUrl;
    }, 90000);

    afterAll(async () => {
      if (server) await server.stop();
    });

    it('round-trips set → get → list → delete via this.secureStore', async () => {
      await withSession(baseUrl, async (client) => {
        // set
        const setRes = (
          await client.tools.call('secret', { op: 'set', key: 'stg.api-key', value: 'top-secret' })
        ).json<SecretOutput>();
        expect(setRes.op).toBe('set');

        // get → present + redacted (never the raw secret)
        const getRes = (await client.tools.call('secret', { op: 'get', key: 'stg.api-key' })).json<SecretOutput>();
        expect(getRes.present).toBe(true);
        expect(getRes.preview).toBe('[redacted]');

        // list → contains the key
        const listRes = (await client.tools.call('secret', { op: 'list' })).json<SecretOutput>();
        expect(listRes.keys).toContain('stg.api-key');

        // delete → existed, then absent
        const delRes = (await client.tools.call('secret', { op: 'delete', key: 'stg.api-key' })).json<SecretOutput>();
        expect(delRes.present).toBe(true);
        const afterGet = (await client.tools.call('secret', { op: 'get', key: 'stg.api-key' })).json<SecretOutput>();
        expect(afterGet.present).toBe(false);
      });
    });
  });

  describe('sqlite backing (persistent, user-scoped)', () => {
    // Use a fixed PORT so the SECOND server (after restart) binds the same port,
    // keeping baseUrl/issuer stable so the same per-account sub is minted.
    const PORT = '53590';
    const sqlitePath = join(tmpdir(), `frontmcp-secure-store-e2e-${process.pid}-${Date.now()}.sqlite`);

    function startServer(): Promise<TestServer> {
      return TestServer.start({
        command: `npx tsx ${SERVER_ENTRY}`,
        project: 'demo-e2e-local-auth',
        port: Number(PORT),
        startupTimeout: 60000,
        debug: process.env['DEBUG'] === '1',
        env: {
          PORT,
          SECURE_STORE_BACKING: 'sqlite',
          SECURE_STORE_SQLITE_PATH: sqlitePath,
          JWT_SECRET,
          VAULT_SECRET,
        },
      });
    }

    afterAll(() => {
      for (const f of [sqlitePath, `${sqlitePath}-wal`, `${sqlitePath}-shm`]) {
        if (existsSync(f)) rmSync(f, { force: true });
      }
    });

    it('persists a secret to disk across a server RESTART (same operator)', async () => {
      // Session 1 on the FIRST process: write a secret, then shut the server down.
      const server1 = await startServer();
      await withSession(server1.info.baseUrl, async (client) => {
        await client.tools.call('secret', { op: 'set', key: 'persist.key', value: 'persisted-secret' });
        const listRes = (await client.tools.call('secret', { op: 'list' })).json<SecretOutput>();
        expect(listRes.keys).toContain('persist.key');
      });
      await server1.stop();

      // The sqlite DB file was created on disk by the first process.
      expect(existsSync(sqlitePath)).toBe(true);

      // Session 2 on a FRESH process (in-memory state gone): the secret survives
      // ONLY because it was persisted to the sqlite file. Same JWT/VAULT secret +
      // same per-account sub means the same namespace + decryption key.
      const server2 = await startServer();
      try {
        await withSession(server2.info.baseUrl, async (client) => {
          const getRes = (await client.tools.call('secret', { op: 'get', key: 'persist.key' })).json<SecretOutput>();
          expect(getRes.present).toBe(true);
          expect(getRes.preview).toBe('[redacted]');
          const listRes = (await client.tools.call('secret', { op: 'list' })).json<SecretOutput>();
          expect(listRes.keys).toContain('persist.key');
        });
      } finally {
        await server2.stop();
      }
    }, 120000);
  });
});
