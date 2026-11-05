// The SDK's skill surfaces (skills/list, skills/search, skill://index.json, initialize) of a server whose bundle
// server is down when it starts: they answer the retryable SKILL_BUNDLE_NOT_LOADED error, also to a stateless HTTP
// client that skips initialize, instead of an empty catalog a client would cache. Once a poll loads the bundle they
// list its skills with bundleVersion, and a connected client is sent notifications/skills/list_changed.
import { expect, test, type McpTestClient, type ServerFixture } from '@frontmcp/testing';

import {
  BUNDLE_AUDIENCE,
  BUNDLE_ISSUER,
  PullTokenIssuer,
  startMockBundleServer,
  type MockBundleServer,
} from './helpers/mock-bundle-server';
import { ProductionEnvironment } from './helpers/production-environment';

const POLL_INTERVAL_MS = 500;
const STATELESS_PROTOCOL = '2026-07-28';

interface JsonRpcAnswer {
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: Record<string, unknown> };
}

interface ListedSkill {
  id: string;
  bundleVersion?: string;
}

const environment = new ProductionEnvironment();
const saasEnv: Record<string, string> = {};
let bundleServer: MockBundleServer;

test.use({
  server: 'apps/e2e/demo-e2e-skilled-openapi/src/saas.main.ts',
  project: 'demo-e2e-skilled-openapi',
  publicMode: true,
  env: saasEnv,
});
test.beforeAll(async () => {
  await environment.start();
  const issuer = await PullTokenIssuer.create('e2e-skill-surfaces-issuer');
  const pullToken = await issuer.pullToken();
  bundleServer = await startMockBundleServer({
    tls: environment.tls,
    jwks: issuer.jwks,
    pullToken,
    published: environment.sign(environment.unsignedBundle),
  });
  bundleServer.mode = 'outage';
  Object.assign(saasEnv, environment.env, {
    SKILLED_SAAS_ENDPOINT: bundleServer.bundleUrl,
    SKILLED_SAAS_JWKS_URL: bundleServer.jwksUrl,
    SKILLED_SAAS_PULL_TOKEN: pullToken,
    SKILLED_SAAS_ISSUER: BUNDLE_ISSUER,
    SKILLED_SAAS_AUDIENCE: BUNDLE_AUDIENCE,
    SKILLED_SAAS_POLL_INTERVAL_MS: String(POLL_INTERVAL_MS),
    SKILLED_BUNDLE_CACHE_DIR: await environment.makeDirectory('bundle-cache-'),
  });
});
test.afterAll(async () => {
  await bundleServer?.stop();
  await environment.stop();
});

/** A request over the session the client opened with initialize. */
async function sessionRequest(
  client: McpTestClient,
  method: string,
  params: Record<string, unknown>,
): Promise<JsonRpcAnswer> {
  return (await client.raw.request({ jsonrpc: '2.0', id: method, method, params })) as JsonRpcAnswer;
}

/** A request as a stateless HTTP client sends it (protocol 2026-07-28): no initialize and no session. */
async function statelessRequest(
  server: ServerFixture,
  method: string,
  params: Record<string, unknown>,
): Promise<JsonRpcAnswer> {
  const meta = {
    'io.modelcontextprotocol/protocolVersion': STATELESS_PROTOCOL,
    'io.modelcontextprotocol/clientCapabilities': {},
    'io.modelcontextprotocol/clientInfo': { name: 'stateless-e2e', version: '1.0.0' },
  };
  const response = await fetch(`${server.info.baseUrl}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': STATELESS_PROTOCOL,
      'Mcp-Method': method,
      ...(typeof params['uri'] === 'string' && { 'Mcp-Name': params['uri'] }),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: meta } }),
  });
  const body = await response.text();
  const sseData = body
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim());
  return JSON.parse(sseData.length > 0 ? sseData[sseData.length - 1] : body) as JsonRpcAnswer;
}

function expectNotLoaded(answer: JsonRpcAnswer): void {
  expect(answer.result).toBeUndefined();
  expect(answer.error?.message).toContain('No skill bundle is loaded: ');
  expect(answer.error?.data).toMatchObject({ code: 'SKILL_BUNDLE_NOT_LOADED', retryable: true });
}

async function until(condition: () => Promise<boolean> | boolean, what: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const listedSkills = (answer: JsonRpcAnswer) => (answer.result?.['skills'] ?? []) as ListedSkill[];

test.describe('a server whose bundle server is down when it starts', () => {
  test('says at initialize that the skills have not loaded yet', async ({ mcp }) => {
    expect(mcp.instructions).toContain("This server's skills have not loaded yet (");
  });

  test('answers skills/list, skills/search and skill://index.json with the retryable not-loaded error', async ({
    mcp,
  }) => {
    expectNotLoaded(await sessionRequest(mcp, 'skills/list', {}));
    expectNotLoaded(await sessionRequest(mcp, 'skills/search', { query: 'invoices' }));
    expectNotLoaded(await sessionRequest(mcp, 'resources/read', { uri: 'skill://index.json' }));
  });

  test('gives the same answer to a stateless HTTP client that skips initialize', async ({ server }) => {
    expectNotLoaded(await statelessRequest(server, 'skills/list', {}));
    expectNotLoaded(await statelessRequest(server, 'resources/read', { uri: 'skill://index.json' }));
  });

  test('lists the skills with their bundleVersion once a poll loads the bundle, after a list_changed', async ({
    mcp,
    server,
  }) => {
    const notifications = mcp.notifications.collect();

    bundleServer.mode = 'serving';
    await until(async () => (await sessionRequest(mcp, 'skills/list', {})).result !== undefined, 'a poll');
    await until(
      () => notifications.received.some(({ method }) => method === 'notifications/skills/list_changed'),
      'notifications/skills/list_changed',
    );

    const listed = listedSkills(await sessionRequest(mcp, 'skills/list', {}));
    const found = listedSkills(await sessionRequest(mcp, 'skills/search', { query: 'invoices' }));
    const statelessListed = listedSkills(await statelessRequest(server, 'skills/list', {}));
    const index = await sessionRequest(mcp, 'resources/read', { uri: 'skill://index.json' });

    expect(listed.map((skill) => skill.id).sort()).toEqual(['invoices', 'reports']);
    expect(listed.map((skill) => skill.bundleVersion)).toEqual(['1.0.0', '1.0.0']);
    expect(found).toContainEqual(expect.objectContaining({ id: 'invoices', bundleVersion: '1.0.0' }));
    expect(statelessListed).toEqual(listed);
    expect(JSON.stringify(index.result)).toContain('skill://Invoices/SKILL.md');
  });
});
