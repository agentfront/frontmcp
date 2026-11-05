// Scenarios B2 B3 B4 J3: the bundle pulled over https from a SaaS bundle server, with a pull token checked against the
// issuer's JWKS: the startup pull, new versions applied by polling, refused tokens, bundles and older versions, the
// cache, redirects. /readyz stays ready but says the bundle served is stale while the last pull was refused or failed.
// The log and /readyz name the check a pull or push token failed; the tools and the push answer don't.
// A pulled or pushed version is announced with one list_changed per list it changed, and a poll of the version served
// with none.
import type { BundleTokenFailure, ResolvedBundle } from '@frontmcp/adapters/skills';
import { expect, test, type McpTestClient, type ServerFixture } from '@frontmcp/testing';
import { chmod, fileExists, pathJoin, readFile } from '@frontmcp/utils';

import {
  BUNDLE_AUDIENCE,
  BUNDLE_ISSUER,
  BUNDLE_PATH,
  JWKS_PATH,
  MOVED_BUNDLE_PATH,
  PullTokenIssuer,
  startMockBundleServer,
  type MockBundleServer,
} from './helpers/mock-bundle-server';
import { ProductionEnvironment } from './helpers/production-environment';
import {
  actionIdsOf,
  loadSkill,
  readiness,
  runWorkflow,
  type Readiness,
  type SearchSkillResponse,
} from './helpers/skilled-client';

const ISSUER_KEY_ID = 'e2e-bundle-issuer';
const POLL_INTERVAL_MS = 500;
/** The source keeps the last bundle at `<bundleCacheDir>/<expectedAudience>.json`, the audience made file-safe. */
const CACHE_FILE_NAME = 'e2e_billing.json';
const CREATE_INVOICE = "return await callTool('createInvoice', { customerId: 'cus_e2e', amount: 10 });";
const GET_PLAN = "return await callTool('getAccountPlan', {});";
const LIST_CHANGED = [
  'notifications/resources/list_changed',
  'notifications/skills/list_changed',
  'notifications/tools/list_changed',
];
const ONE_LIST_CHANGED_EACH = Object.fromEntries(LIST_CHANGED.map((method) => [method, 1]));

type BundledSkill = ResolvedBundle['skills'][number];

const REFUNDS_SKILL: BundledSkill = {
  id: 'refunds',
  name: 'Refunds',
  description: 'Refund paid invoices on the demo billing service.',
  instructions: '# Refunds skill\n\nRead the invoice with getInvoice, then refund it with refundInvoice.',
  tags: ['billing', 'refunds'],
  operationIds: ['getInvoice', 'refundInvoice'],
};

const V1_SKILLS = ['billing-admin', 'invoices', 'reports'];
const V2_SKILLS = ['billing-admin', 'invoices', 'refunds'];

const environment = new ProductionEnvironment();
let issuer: PullTokenIssuer;
let pullToken: string;
let bundleServer: MockBundleServer;

/** The unsigned billing bundle at `version`, serving `skillIds` of the fixture's skills and the refunds skill. */
function billingBundle(version: string, skillIds: readonly string[]): ResolvedBundle {
  const { unsignedBundle } = environment;
  const skills = [...unsignedBundle.skills, REFUNDS_SKILL].filter((skill) => skillIds.includes(skill.id));
  return { ...unsignedBundle, version, skills };
}

test.use({
  server: 'apps/e2e/demo-e2e-skilled-openapi/src/saas.main.ts',
  project: 'demo-e2e-skilled-openapi',
  publicMode: true,
  env: environment.env,
});
test.beforeAll(async () => {
  await environment.start();
  issuer = await PullTokenIssuer.create(ISSUER_KEY_ID);
  pullToken = await issuer.pullToken();
  bundleServer = await startMockBundleServer({
    tls: environment.tls,
    jwks: issuer.jwks,
    pullToken,
    published: environment.sign(billingBundle('1.0.0', V1_SKILLS)),
  });
});
test.afterAll(async () => {
  await bundleServer?.stop();
  await environment.stop();
});

interface SaasServerSetup {
  /** The pull token the server is set up with; by default, the one the bundle server issued it. */
  pullToken?: () => Promise<string>;
  readOnlyCache?: boolean;
  /** Take bundles pushed to `POST /__skilled_openapi/push`. */
  enableWebhook?: boolean;
}

/**
 * Run this block's server against the bundle server, which serves version 1.0.0, with a cache directory of its own.
 * Returns the server's environment, which names that directory.
 */
function useSaasServer(setup: SaasServerSetup = {}): Record<string, string> {
  const env: Record<string, string> = {};
  test.use({ env });
  test.beforeAll(async () => {
    bundleServer.reset();
    const cacheDir = await environment.makeDirectory('bundle-cache-');
    if (setup.readOnlyCache) await chmod(cacheDir, 0o555);
    Object.assign(env, {
      SKILLED_SAAS_ENDPOINT: bundleServer.bundleUrl,
      SKILLED_SAAS_JWKS_URL: bundleServer.jwksUrl,
      SKILLED_SAAS_PULL_TOKEN: setup.pullToken ? await setup.pullToken() : pullToken,
      SKILLED_SAAS_ISSUER: BUNDLE_ISSUER,
      SKILLED_SAAS_AUDIENCE: BUNDLE_AUDIENCE,
      SKILLED_SAAS_POLL_INTERVAL_MS: String(POLL_INTERVAL_MS),
      SKILLED_BUNDLE_CACHE_DIR: cacheDir,
      SKILLED_SAAS_ENABLE_WEBHOOK: String(setup.enableWebhook === true),
    });
  });
  return env;
}

async function cachedBundleVersion(env: Record<string, string>): Promise<string | undefined> {
  const cacheFile = pathJoin(env['SKILLED_BUNDLE_CACHE_DIR'], CACHE_FILE_NAME);
  if (!(await fileExists(cacheFile))) return undefined;
  return (JSON.parse(await readFile(cacheFile)) as ResolvedBundle).version;
}

async function until(condition: () => boolean | Promise<boolean>, what: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** The skills search_skill finds for "billing", by id, and the bundle versions they come from. */
async function servedSkills(client: McpTestClient): Promise<{ ids: string[]; versions: string[] }> {
  const skills = (await client.tools.call('search_skill', { query: 'billing' })).json<SearchSkillResponse>().skills;
  return {
    ids: skills.map((skill) => skill.skillId).sort(),
    versions: [...new Set(skills.map((skill) => skill.bundleVersion ?? 'none'))],
  };
}

/** The skilled-openapi check of /readyz, which must still answer ready. */
async function readyCheck(server: ServerFixture) {
  const ready = await readiness(server.info.baseUrl);
  expect(ready).toMatchObject({ httpStatus: 200, status: 'ready' });
  return ready.probes?.['skilled-openapi'];
}

type NotificationLog = ReturnType<McpTestClient['notifications']['collect']>;

/** The `list_changed` notifications the client got after the first `seen`, counted by method. */
function listChangedCounts(notifications: NotificationLog, seen: number): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { method } of notifications.received.slice(seen)) {
    if (method.endsWith('/list_changed')) counts[method] = (counts[method] ?? 0) + 1;
  }
  return counts;
}

/** Wait for the client to be told of each list a swap changed, then for the polls after it, which bring no change. */
async function listChangedBySwap(notifications: NotificationLog, seen: number): Promise<Record<string, number>> {
  await until(
    () => LIST_CHANGED.every((method) => listChangedCounts(notifications, seen)[method] !== undefined),
    'the list_changed notifications',
  );
  await new Promise((resolve) => setTimeout(resolve, 3 * POLL_INTERVAL_MS));
  return listChangedCounts(notifications, seen);
}

function waitForLog(server: ServerFixture, text: string): Promise<void> {
  return until(() => server.getLogs().join('\n').includes(text), `the log line "${text}"`);
}

interface UnloadedAnswers {
  errors: boolean[];
  codes: unknown[];
  /** The distinct texts the meta-tools answer. */
  reasons: Array<string | undefined>;
  ready: Readiness;
}

/** What each meta-tool answers, and /readyz, while the server has no bundle to serve. */
async function unloadedAnswers(mcp: McpTestClient, server: ServerFixture): Promise<UnloadedAnswers> {
  const results = [
    await mcp.tools.call('search_skill', { query: 'billing' }),
    await mcp.tools.call('load_skill', { skillId: 'invoices' }),
    await mcp.tools.call('execute_action', { actionId: 'getAccountPlan' }),
    await mcp.tools.call('run_workflow', { script: GET_PLAN }),
  ];
  return {
    errors: results.map((result) => result.isError),
    codes: results.map((result) => result.raw._meta?.['code']),
    reasons: [...new Set(results.map((result) => result.text()))],
    ready: await readiness(server.info.baseUrl),
  };
}

function expectNoBundleLoaded(answers: UnloadedAnswers, reason: string): void {
  expect(answers.errors).toEqual([true, true, true, true]);
  expect(answers.codes).toEqual(Array(4).fill('SKILL_BUNDLE_NOT_LOADED'));
  expect(answers.reasons).toEqual([`No skill bundle is loaded: ${reason}`]);
  expect(answers.ready).toMatchObject({ httpStatus: 503, status: 'not_ready' });
  expect(answers.ready.probes?.['skilled-openapi']).toMatchObject({
    status: 'unhealthy',
    error: `no skill bundle is loaded: ${reason}`,
  });
}

test.describe('a bundle pulled from the bundle server', () => {
  const env = useSaasServer();

  test('is pulled at startup with the pull token, after a JWKS read without it, served and kept in the cache', async ({
    mcp,
    server,
  }) => {
    const served = await servedSkills(mcp);
    const loaded = await loadSkill(mcp, 'invoices');
    const workflow = await runWorkflow(mcp, CREATE_INVOICE);
    const jwksReads = bundleServer.requestsTo(JWKS_PATH);

    expect(served).toEqual({ ids: ['invoices', 'reports'], versions: ['1.0.0'] });
    expect(loaded).toMatchObject({ id: 'invoices', bundleVersion: '1.0.0' });
    expect(workflow).toMatchObject({ success: true, value: { status: 'open' } });
    expect(bundleServer.requestsTo(BUNDLE_PATH)[0]).toEqual({
      path: BUNDLE_PATH,
      authorization: `Bearer ${pullToken}`,
    });
    expect(jwksReads.length).toBeGreaterThan(0);
    expect(jwksReads.every((request) => request.authorization === undefined)).toBe(true);
    expect((await readiness(server.info.baseUrl)).probes?.['skilled-openapi']?.details).toEqual({
      state: 'loaded',
      bundleId: 'e2e:billing',
      bundleVersion: '1.0.0',
    });
    expect(await cachedBundleVersion(env)).toBe('1.0.0');
  });

  test('applies a new version on a poll: skills and actions change together, and connected clients are told once per list', async ({
    mcp,
    server,
  }) => {
    const notifications = mcp.notifications.collect();
    const seen = notifications.received.length;

    bundleServer.published = environment.sign(billingBundle('2.0.0', V2_SKILLS));
    await until(async () => (await servedSkills(mcp)).versions.includes('2.0.0'), 'version 2.0.0');
    const notified = await listChangedBySwap(notifications, seen);

    const removed = await mcp.tools.call('load_skill', { skillId: 'reports' });
    const added = await loadSkill(mcp, 'refunds');
    const removedAction = await runWorkflow(mcp, GET_PLAN);
    const keptAction = await runWorkflow(mcp, CREATE_INVOICE);

    expect(notified).toEqual(ONE_LIST_CHANGED_EACH);
    expect(await servedSkills(mcp)).toEqual({ ids: ['invoices', 'refunds'], versions: ['2.0.0'] });
    expect(removed.isError).toBe(true);
    expect(added).toMatchObject({ id: 'refunds', bundleVersion: '2.0.0' });
    expect(actionIdsOf(added)).toContain('getInvoice');
    expect(removedAction).toMatchObject({ success: false, error: expect.stringContaining('"getAccountPlan"') });
    expect(keptAction).toMatchObject({ success: true, value: { status: 'open' } });
    expect((await readiness(server.info.baseUrl)).probes?.['skilled-openapi']?.details).toMatchObject({
      bundleVersion: '2.0.0',
    });
    expect(await cachedBundleVersion(env)).toBe('2.0.0');
  });

  test('does not apply a new version changed after it was signed: the version before keeps serving', async ({
    mcp,
    server,
  }) => {
    const signed = environment.sign(billingBundle('3.0.0', ['invoices']));
    bundleServer.published = { ...signed, skills: [...signed.skills, REFUNDS_SKILL] };

    await waitForLog(server, '[bundle-sync] rejected bundle e2e:billing@3.0.0: digest mismatch');

    expect(await servedSkills(mcp)).toEqual({ ids: ['invoices', 'refunds'], versions: ['2.0.0'] });
    expect(await runWorkflow(mcp, CREATE_INVOICE)).toMatchObject({ success: true });
    expect(await readyCheck(server)).toEqual({
      status: 'degraded',
      details: {
        state: 'stale',
        bundleId: 'e2e:billing',
        bundleVersion: '2.0.0',
        lastSync: {
          status: 'refused',
          bundleId: 'e2e:billing',
          bundleVersion: '3.0.0',
          reason: expect.stringContaining('digest mismatch'),
          at: expect.any(String),
        },
      },
    });
  });

  test('does not apply a new version that fails the bundle schema: the version before keeps serving', async ({
    mcp,
    server,
  }) => {
    bundleServer.published = JSON.stringify({ ...billingBundle('4.0.0', ['invoices']), skills: [{ id: 'broken' }] });

    await waitForLog(
      server,
      '[saas-source] poll failed: Bundle schema validation failed (4 issue(s)): skills.0.name: ',
    );

    expect(await servedSkills(mcp)).toEqual({ ids: ['invoices', 'refunds'], versions: ['2.0.0'] });
    expect(await runWorkflow(mcp, CREATE_INVOICE)).toMatchObject({ success: true });
    expect(await cachedBundleVersion(env)).not.toBe('4.0.0');
    expect(await readyCheck(server)).toMatchObject({
      status: 'degraded',
      details: {
        state: 'stale',
        bundleVersion: '2.0.0',
        lastSync: {
          status: 'failed',
          reason: expect.stringContaining('Bundle schema validation failed (4 issue(s)): skills.0.name: '),
          cacheFallback: false,
        },
      },
    });
  });

  test('does not apply an older signed version on a poll: the version served stays, and stays cached', async ({
    mcp,
    server,
  }) => {
    bundleServer.published = environment.sign(billingBundle('1.0.0', V1_SKILLS));

    await waitForLog(
      server,
      '[bundle-sync] bundle e2e:billing@1.0.0 not applied: older than the served bundle e2e:billing@2.0.0',
    );

    expect(await servedSkills(mcp)).toEqual({ ids: ['invoices', 'refunds'], versions: ['2.0.0'] });
    expect(await runWorkflow(mcp, CREATE_INVOICE)).toMatchObject({ success: true });
    expect(await cachedBundleVersion(env)).toBe('2.0.0');
    expect(await readyCheck(server)).toMatchObject({
      status: 'degraded',
      details: {
        state: 'stale',
        bundleVersion: '2.0.0',
        lastSync: {
          status: 'refused',
          bundleVersion: '1.0.0',
          reason: expect.stringContaining('older than the served bundle e2e:billing@2.0.0'),
        },
      },
    });
  });

  test('is healthy again once a poll applies a newer version', async ({ mcp, server }) => {
    bundleServer.published = environment.sign(billingBundle('5.0.0', V2_SKILLS));

    await until(async () => (await servedSkills(mcp)).versions.includes('5.0.0'), 'version 5.0.0');

    expect(await readyCheck(server)).toEqual({
      status: 'healthy',
      details: { state: 'loaded', bundleId: 'e2e:billing', bundleVersion: '5.0.0' },
    });
  });
});

test.describe('a workflow that runs while a new version is applied', () => {
  useSaasServer();

  test('finishes on the operations of the version it started on', async ({ mcp, server }) => {
    const slowReportsThenPlan = [
      'for (let call = 0; call < 16; call += 1) {',
      "  await callTool('getRevenueReport', {}, { throwOnError: false });",
      '}',
      GET_PLAN,
    ].join('\n');
    expect((await servedSkills(mcp)).ids).toContain('reports');
    environment.billingApi.reset();
    const observer = await server.createClient();
    let workflowFinished = false;

    const running = runWorkflow(mcp, slowReportsThenPlan).finally(() => {
      workflowFinished = true;
    });
    await until(
      () => environment.billingApi.requests.some((request) => request.path === '/v1/reports/revenue'),
      'the workflow to call the billing API',
    );
    bundleServer.published = environment.sign(billingBundle('2.0.0', V2_SKILLS));
    await until(async () => (await servedSkills(observer)).versions.includes('2.0.0'), 'version 2.0.0');

    expect(workflowFinished).toBe(false);
    expect(await running).toMatchObject({ success: true, value: { plan: 'growth' } });
    expect(await runWorkflow(mcp, GET_PLAN)).toMatchObject({ success: false });
  });
});

interface RefusedPullToken {
  label: string;
  token: () => Promise<string>;
  /** What the tools answer: the same for every token the issuer's checks refuse. */
  reason: string;
  /** The check that refused it, which only the log and /readyz name. */
  tokenFailure: BundleTokenFailure;
}

const REFUSED_PULL_TOKENS: readonly RefusedPullToken[] = [
  {
    label: 'issued for another audience',
    token: () => issuer.pullToken({ aud: 'e2e:another-server' }),
    reason: 'its "aud" claim does not include "e2e:billing"',
    tokenFailure: 'wrong_audience',
  },
  {
    label: 'from another issuer',
    token: () => issuer.pullToken({ iss: 'https://impostor.e2e.example' }),
    reason: 'not a valid token from issuer',
    tokenFailure: 'wrong_issuer',
  },
  {
    label: 'that has expired',
    token: () => issuer.pullToken({}, { issuedAt: '2 hours ago', expiresAt: '1 hour ago' }),
    reason: 'not a valid token from issuer',
    tokenFailure: 'expired',
  },
  {
    label: 'signed by a key outside the JWKS',
    token: async () => (await PullTokenIssuer.create(ISSUER_KEY_ID)).pullToken(),
    reason: 'not a valid token from issuer',
    tokenFailure: 'bad_signature',
  },
  {
    label: 'signed under a key id the JWKS does not publish',
    token: async () => (await PullTokenIssuer.create('e2e-retired-issuer')).pullToken(),
    reason: 'not a valid token from issuer',
    tokenFailure: 'unknown_key',
  },
];

for (const refused of REFUSED_PULL_TOKENS) {
  test.describe(`a pull token ${refused.label}`, () => {
    const env = useSaasServer({ pullToken: refused.token });

    test('is refused: nothing is pulled or applied, the tools answer SKILL_BUNDLE_NOT_LOADED and /readyz 503', async ({
      mcp,
      server,
    }) => {
      const answers = await unloadedAnswers(mcp, server);
      const [reason = ''] = answers.reasons;

      expect(reason).toContain(`[saas-source] pull token rejected: ${refused.reason}`);
      expect(reason).not.toContain(refused.tokenFailure);
      expectNoBundleLoaded(answers, reason.replace('No skill bundle is loaded: ', ''));
      expect(answers.ready.probes?.['skilled-openapi']?.details).toMatchObject({
        state: 'failed',
        lastSync: { status: 'failed', tokenFailure: refused.tokenFailure, cacheFallback: false },
      });
      await waitForLog(server, `: pull token check failed (${refused.tokenFailure})`);
      expect(server.getLogs().join('\n')).not.toContain(env['SKILLED_SAAS_PULL_TOKEN']);
      expect(bundleServer.requestsTo(JWKS_PATH).length).toBeGreaterThan(0);
      expect(bundleServer.requestsTo(BUNDLE_PATH)).toEqual([]);
      expect(await cachedBundleVersion(env)).toBeUndefined();
    });
  });
}

/** Push `body` to the server's push endpoint with `token`. */
function pushBundle(server: ServerFixture, token: string, body: unknown): Promise<Response> {
  return fetch(`${server.info.baseUrl}/__skilled_openapi/push`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test.describe('a server that takes pushed bundles', () => {
  useSaasServer({ enableWebhook: true });

  test("answers a push 503 while the issuer's JWKS can't be read, and the log names jwks_unavailable", async ({
    mcp,
    server,
  }) => {
    expect((await servedSkills(mcp)).versions).toEqual(['1.0.0']);
    const token = await issuer.pullToken({ jti: 'e2e-push-during-outage' });
    bundleServer.mode = 'outage';

    try {
      const response = await pushBundle(server, token, environment.sign(billingBundle('2.0.0', V2_SKILLS)));

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: 'temporarily_unavailable',
        error_description: "the issuer's JWKS could not be read",
      });
      await waitForLog(server, 'bundle push not checked (jwks_unavailable): fetch failed');
    } finally {
      bundleServer.mode = 'serving';
    }
  });

  test('answers a push token from another issuer with the generic 401, while the log names the check', async ({
    mcp,
    server,
  }) => {
    const token = await issuer.pullToken({ iss: 'https://impostor.e2e.example', jti: 'e2e-push-impostor' });

    const response = await pushBundle(server, token, environment.sign(billingBundle('2.0.0', V2_SKILLS)));

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer error="invalid_token"');
    expect(await response.json()).toEqual({ error: 'invalid_token', error_description: 'the push token was refused' });
    await waitForLog(server, '[saas-source] push refused (wrong_issuer): not a valid token from issuer');
    expect(server.getLogs().join('\n')).not.toContain(token);
    expect((await servedSkills(mcp)).versions).toEqual(['1.0.0']);
  });

  test('applies a pushed version and tells connected clients once per list it changed', async ({ mcp, server }) => {
    const notifications = mcp.notifications.collect();
    const seen = notifications.received.length;
    const token = await issuer.pullToken({ jti: 'e2e-push-applied' });

    const response = await pushBundle(server, token, environment.sign(billingBundle('2.0.0', V2_SKILLS)));
    const notified = await listChangedBySwap(notifications, seen);

    expect(response.status).toBe(200);
    expect(notified).toEqual(ONE_LIST_CHANGED_EACH);
    expect(await servedSkills(mcp)).toEqual({ ids: ['invoices', 'refunds'], versions: ['2.0.0'] });
  });
});

test.describe('a bundle server that is down at startup', () => {
  test.describe('with the bundle kept in the cache by an earlier run', () => {
    useSaasServer();

    test('starts, and serves the cached bundle', async ({ mcp, server }) => {
      expect((await servedSkills(mcp)).versions).toEqual(['1.0.0']);
      bundleServer.mode = 'outage';
      server.clearLogs();

      await server.restart();

      expect(await servedSkills(mcp)).toEqual({ ids: ['invoices', 'reports'], versions: ['1.0.0'] });
      expect(await runWorkflow(mcp, CREATE_INVOICE)).toMatchObject({ success: true });
      expect(await readyCheck(server)).toMatchObject({
        status: 'degraded',
        details: {
          state: 'stale',
          bundleVersion: '1.0.0',
          lastSync: { status: 'failed', reason: 'fetch failed', tokenFailure: 'jwks_unavailable', cacheFallback: true },
        },
      });
      expect(server.getLogs().join('\n')).toContain('[saas-source] using cached bundle "e2e:billing@1.0.0"');
    });
  });

  test.describe('after a new version was refused for its signature', () => {
    const env = useSaasServer();

    test('serves the version before it from the cache: a refused version is never cached', async ({ mcp, server }) => {
      expect((await servedSkills(mcp)).versions).toEqual(['1.0.0']);
      const signed = environment.sign(billingBundle('2.0.0', V1_SKILLS));
      bundleServer.published = { ...signed, skills: [...signed.skills, REFUNDS_SKILL] };
      await waitForLog(server, '[bundle-sync] rejected bundle e2e:billing@2.0.0: digest mismatch');
      const cachedBeforeRestart = await cachedBundleVersion(env);
      bundleServer.mode = 'outage';
      server.clearLogs();

      await server.restart();

      expect(cachedBeforeRestart).toBe('1.0.0');
      expect(await servedSkills(mcp)).toEqual({ ids: ['invoices', 'reports'], versions: ['1.0.0'] });
      expect(await runWorkflow(mcp, CREATE_INVOICE)).toMatchObject({ success: true });
      expect((await readiness(server.info.baseUrl)).httpStatus).toBe(200);
      expect(server.getLogs().join('\n')).toContain('[saas-source] using cached bundle "e2e:billing@1.0.0"');
    });
  });

  test.describe('with no cached bundle', () => {
    useSaasServer();
    test.beforeAll(() => {
      bundleServer.mode = 'outage';
    });

    test('answers SKILL_BUNDLE_NOT_LOADED, then serves the bundle from the first poll that succeeds', async ({
      mcp,
      server,
    }) => {
      const answers = await unloadedAnswers(mcp, server);

      bundleServer.mode = 'serving';
      await until(async () => !(await mcp.tools.call('search_skill', { query: 'billing' })).isError, 'a poll');

      expectNoBundleLoaded(
        answers,
        '[saas-source] initial pull failed and no cached bundle is available at [path] fetch failed',
      );
      expect(await servedSkills(mcp)).toEqual({ ids: ['invoices', 'reports'], versions: ['1.0.0'] });
      expect(await runWorkflow(mcp, CREATE_INVOICE)).toMatchObject({ success: true });
      expect((await readiness(server.info.baseUrl)).httpStatus).toBe(200);
    });
  });
});

test.describe('a bundle endpoint that answers with a redirect', () => {
  useSaasServer();
  test.beforeAll(() => {
    bundleServer.mode = 'redirecting';
  });

  test('is not followed: the pull token never reaches the redirect target, and no bundle loads', async ({
    mcp,
    server,
  }) => {
    const answers = await unloadedAnswers(mcp, server);

    expectNoBundleLoaded(
      answers,
      '[saas-source] initial pull failed and no cached bundle is available at [path] pull endpoint returned a redirect (302); not followed to protect the bearer token',
    );
    expect(bundleServer.requestsTo(BUNDLE_PATH).length).toBeGreaterThan(0);
    expect(bundleServer.requestsTo(MOVED_BUNDLE_PATH)).toEqual([]);
  });
});

test.describe('a cache directory the server cannot write, as on a serverless cold start', () => {
  test.skip(
    process.getuid?.() === 0 || process.platform === 'win32',
    'mode bits do not stop root or Windows from writing to the directory',
  );
  const env = useSaasServer({ readOnlyCache: true });

  test('does not stop the pulled bundle from serving, and the log says it was not cached', async ({ mcp, server }) => {
    expect(await servedSkills(mcp)).toEqual({ ids: ['invoices', 'reports'], versions: ['1.0.0'] });
    expect(await runWorkflow(mcp, CREATE_INVOICE)).toMatchObject({ success: true });
    await waitForLog(server, '[saas-source] cache persist failed: EACCES');
    expect(await cachedBundleVersion(env)).toBeUndefined();
  });
});
