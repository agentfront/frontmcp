/**
 * E2E — PROGRESSIVE / INCREMENTAL authorization round-trip (orchestrated/local).
 *
 * Proves the full vault-expansion contract end-to-end over real HTTP:
 *
 *   1. authorize app A (Notes)            → token grants authorized_apps:[Notes]
 *   2. call a Notes tool                  → SUCCESS
 *   3. call a Tasks tool                  → 403 AuthorizationRequired (the gate)
 *   4. INCREMENTAL authorize app B (Tasks), carrying the prior grant
 *                                          → token grants [Notes, Tasks]
 *   5. call the Tasks tool with the new token → SUCCESS
 *   6. call the Notes tool with the new token → STILL SUCCESS (A not re-authorized)
 *
 * The server (`main.incremental.ts`) sets `incrementalAuth.enabled: true`, which
 * is what turns on app-level gating and the expansion path. A server WITHOUT
 * `incrementalAuth` mints no `authorized_apps` claim and is unaffected (covered
 * by the existing orchestrated-auth e2e and the unit tests).
 */
import { expect, TestServer } from '@frontmcp/testing';
import { generateCodeVerifier, sha256Base64url } from '@frontmcp/utils';

const SERVER_ENTRY = 'apps/e2e/demo-e2e-orchestrated/src/main.incremental.ts';

const REDIRECT_URI = 'http://127.0.0.1:9876/callback';
const CLIENT_ID = 'incremental-test-client';

// App ids: app.id = metadata.id ?? idFromString(metadata.name); the Notes/Tasks
// apps have no explicit id, so their ids are their names.
const APP_NOTES = 'Notes';
const APP_TASKS = 'Tasks';

function makePkce() {
  const verifier = generateCodeVerifier();
  return { verifier, challenge: sha256Base64url(verifier) };
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const [, payloadB64] = jwt.split('.');
  const json = Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  return JSON.parse(json) as Record<string, unknown>;
}

/**
 * GET /oauth/authorize → extract pending_auth_id from the login page.
 * `apps` (comma-separated) declares the apps to grant; `mode=incremental&app=`
 * drives an incremental authorize.
 */
async function startAuthorization(
  baseUrl: string,
  challenge: string,
  opts: { apps?: string[]; mode?: 'incremental'; app?: string } = {},
): Promise<string> {
  const url = new URL(`${baseUrl}/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('scope', 'read write');
  if (opts.apps) url.searchParams.set('apps', opts.apps.join(','));
  if (opts.mode) url.searchParams.set('mode', opts.mode);
  if (opts.app) url.searchParams.set('app', opts.app);

  const res = await fetch(url.toString(), { method: 'GET', redirect: 'manual' });
  expect(res.status).toBe(200);
  const html = await res.text();
  const match = html.match(/name="pending_auth_id"\s+value="([^"]+)"/);
  expect(match).toBeTruthy();
  return match![1];
}

/** GET /oauth/callback → mint a code (returns the redirect `code`). */
async function completeLogin(baseUrl: string, pendingAuthId: string, incremental?: { app: string }): Promise<string> {
  const url = new URL(`${baseUrl}/oauth/callback`);
  url.searchParams.set('pending_auth_id', pendingAuthId);
  if (incremental) {
    // Mirror exactly what the incremental auth page submits back to the callback.
    url.searchParams.set('incremental', 'true');
    url.searchParams.set('app_id', incremental.app);
  }
  const res = await fetch(url.toString(), { method: 'GET', redirect: 'manual' });
  expect([302, 303]).toContain(res.status);
  const location = res.headers.get('location');
  expect(location).toBeTruthy();
  const code = new URL(location!).searchParams.get('code');
  expect(code).toBeTruthy();
  return code!;
}

/** POST /oauth/token (authorization_code grant). */
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
  expect(body.access_token.split('.')).toHaveLength(3);
  return body.access_token;
}

/** Full authorize → callback → token, returning the access token. */
async function authorizeForApps(baseUrl: string, apps: string[]): Promise<string> {
  const { verifier, challenge } = makePkce();
  const pendingAuthId = await startAuthorization(baseUrl, challenge, { apps });
  const code = await completeLogin(baseUrl, pendingAuthId);
  return exchangeToken(baseUrl, code, verifier);
}

/** Incremental authorize for `app`, carrying `priorApps` forward. */
async function incrementalAuthorize(baseUrl: string, app: string, priorApps: string[]): Promise<string> {
  const { verifier, challenge } = makePkce();
  const pendingAuthId = await startAuthorization(baseUrl, challenge, { mode: 'incremental', app, apps: priorApps });
  const code = await completeLogin(baseUrl, pendingAuthId, { app });
  return exchangeToken(baseUrl, code, verifier);
}

interface McpSession {
  sessionId: string;
}

/** Initialize an MCP streamable-http session with the given bearer token. */
async function initSession(baseUrl: string, token: string): Promise<McpSession> {
  const res = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'inc-e2e', version: '1.0' } },
    }),
  });
  expect(res.status).toBe(200);
  const sessionId = res.headers.get('mcp-session-id');
  expect(sessionId).toBeTruthy();
  return { sessionId: sessionId! };
}

/** Parse a (possibly SSE-framed) JSON-RPC response body. */
function parseRpc(text: string): any {
  // SSE frames look like `event: message\ndata: {...}\n\n`.
  const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
  const json = dataLine ? dataLine.slice('data:'.length).trim() : text.trim();
  return JSON.parse(json);
}

/** Call a tool over the MCP session; return the parsed JSON-RPC envelope. */
async function callTool(
  baseUrl: string,
  token: string,
  session: McpSession,
  name: string,
  args: Record<string, unknown>,
): Promise<any> {
  const res = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
      'mcp-session-id': session.sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const text = await res.text();
  return parseRpc(text);
}

describe('Progressive/Incremental Authorization E2E (orchestrated/local)', () => {
  let server: TestServer;
  let baseUrl: string;

  beforeAll(async () => {
    server = await TestServer.start({
      command: `npx tsx ${SERVER_ENTRY}`,
      project: 'demo-e2e-orchestrated',
      startupTimeout: 60000,
      debug: process.env['DEBUG'] === '1',
    });
    baseUrl = server.info.baseUrl;
  }, 90000);

  afterAll(async () => {
    if (server) await server.stop();
  });

  it('mints an authorized_apps claim scoped to the requested apps', async () => {
    const token = await authorizeForApps(baseUrl, [APP_NOTES]);
    const payload = decodeJwtPayload(token);
    expect(payload['authorized_apps']).toEqual([APP_NOTES]);
  });

  it('completes the full round-trip: authorize A → call B 403 → incremental authorize B → call B success (A still works)', async () => {
    // 1. Authorize app A (Notes) only.
    const tokenA = await authorizeForApps(baseUrl, [APP_NOTES]);
    expect(decodeJwtPayload(tokenA)['authorized_apps']).toEqual([APP_NOTES]);

    const sessionA = await initSession(baseUrl, tokenA);

    // 2. A Notes tool succeeds with token A.
    const notesOk = await callTool(baseUrl, tokenA, sessionA, 'create-note', {
      title: 'Hello',
      content: 'From the incremental e2e',
    });
    expect(notesOk.error).toBeUndefined();
    expect(notesOk.result?.isError).toBeFalsy();

    // 3. A Tasks tool is GATED → AuthorizationRequired (403 shape).
    const tasksDenied = await callTool(baseUrl, tokenA, sessionA, 'create-task', { title: 'Blocked task' });
    // The error surfaces as a CallToolResult with isError + the AUTHORIZATION_REQUIRED _meta.
    expect(tasksDenied.result?.isError).toBe(true);
    const meta = tasksDenied.result?._meta ?? {};
    expect(meta['authorization_required']).toBe(true);
    expect(meta['code']).toBe('AUTHORIZATION_REQUIRED');
    expect(meta['app']).toBe(APP_TASKS);
    expect(typeof meta['auth_url']).toBe('string');
    expect(meta['supports_incremental']).toBe(true);

    // 4. INCREMENTAL authorize app B (Tasks), carrying the prior grant (Notes).
    const tokenB = await incrementalAuthorize(baseUrl, APP_TASKS, [APP_NOTES]);
    expect(new Set(decodeJwtPayload(tokenB)['authorized_apps'] as string[])).toEqual(new Set([APP_NOTES, APP_TASKS]));

    const sessionB = await initSession(baseUrl, tokenB);

    // 5. The Tasks tool now SUCCEEDS with the expanded token.
    const tasksOk = await callTool(baseUrl, tokenB, sessionB, 'create-task', { title: 'Now allowed' });
    expect(tasksOk.result?.isError).toBeFalsy();
    expect(tasksOk.error).toBeUndefined();

    // 6. App A (Notes) STILL works with the expanded token (not re-authorized).
    const notesStillOk = await callTool(baseUrl, tokenB, sessionB, 'create-note', {
      title: 'Still here',
      content: 'A keeps working',
    });
    expect(notesStillOk.result?.isError).toBeFalsy();
    expect(notesStillOk.error).toBeUndefined();
  }, 60000);

  it('renders the incremental authorization page for an incremental authorize request', async () => {
    const { challenge } = makePkce();
    const url = new URL(`${baseUrl}/oauth/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', CLIENT_ID);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('mode', 'incremental');
    url.searchParams.set('app', APP_TASKS);
    url.searchParams.set('apps', APP_NOTES);

    const res = await fetch(url.toString(), { redirect: 'manual' });
    expect(res.status).toBe(200);
    const html = await res.text();
    // The incremental auth page is single-app and references the target app.
    expect(html).toContain('Authorization Required');
    expect(html).toContain('incremental');
    expect(html).toContain(APP_TASKS);
  });
});
