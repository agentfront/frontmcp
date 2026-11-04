// Scenario F4: the billing API receives each caller's own token, the one they connected at sign-in, never the server's.
import { expect, test, type ServerFixture } from '@frontmcp/testing';

import { signIn } from './helpers/local-sign-in';
import { ProductionEnvironment } from './helpers/production-environment';
import { runWorkflow } from './helpers/skilled-client';

const environment = new ProductionEnvironment();

test.use({
  server: 'apps/e2e/demo-e2e-skilled-openapi/src/caller-credentials.main.ts',
  project: 'demo-e2e-skilled-openapi',
  auth: { mode: 'local' },
  env: environment.env,
});
test.beforeAll(() => environment.start());
test.afterAll(() => environment.stop());
test.beforeEach(() => environment.billingApi.reset());

const PLAN_SCRIPT = "return await callTool('getAccountPlan', {});";

async function signedInClient(server: ServerFixture, fields: Record<string, string>) {
  return server.createClient({ token: await signIn(server.info.baseUrl, fields) });
}

function authorizationsSent(): Array<string | undefined> {
  return environment.billingApi.requests.map((request) => request.authorization);
}

test.describe("a binding that sends the caller's own credential", () => {
  test('sends each caller the billing token they connected, when two callers run the same action', async ({
    server,
  }) => {
    const { alice: aliceToken, bob: bobToken } = environment.callerBillingTokens;
    const alice = await signedInClient(server, { user: 'alice', billingToken: aliceToken });
    const bob = await signedInClient(server, { user: 'bob', billingToken: bobToken });

    const results = [
      await runWorkflow(alice, PLAN_SCRIPT),
      await runWorkflow(bob, PLAN_SCRIPT),
      await runWorkflow(alice, PLAN_SCRIPT),
    ];

    for (const result of results) expect(result).toMatchObject({ success: true, value: { plan: 'growth' } });
    expect(authorizationsSent()).toEqual([`Bearer ${aliceToken}`, `Bearer ${bobToken}`, `Bearer ${aliceToken}`]);
  });

  test('asks a caller who has not connected the billing API to connect it, sending nothing', async ({ server }) => {
    const carol = await signedInClient(server, { user: 'carol' });

    const result = await carol.tools.call('run_workflow', { script: PLAN_SCRIPT });

    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe(-32001);
    expect(result.error?.message).toContain(
      `sends the caller's own "billing" credential, which this caller hasn't connected`,
    );
    expect(result.error?.message).not.toContain('/oauth/connect');
    expect(result.error?.data).toMatchObject({ tool: 'run_workflow', providers: ['billing'] });
    expect((result.error?.data as { authUrl?: string } | undefined)?.authUrl).toContain('/oauth/connect?token=');
    expect(authorizationsSent()).toEqual([]);
  });
});
