// Scenarios F3 E6: with the plugin in an @App that declares SkilledOpenApiCredentialResolver, every path sends its credential.
import { expect, test } from '@frontmcp/testing';

import { ProductionEnvironment } from './helpers/production-environment';
import { executeAction, runWorkflow, SKILLED_SERVER } from './helpers/skilled-client';

const environment = new ProductionEnvironment();

test.use({
  ...SKILLED_SERVER,
  server: 'apps/e2e/demo-e2e-skilled-openapi/src/app-resolver.main.ts',
  env: environment.env,
});
test.beforeAll(() => environment.start());
test.afterAll(() => environment.stop());
test.beforeEach(() => environment.billingApi.reset());

test.describe('a credential resolver declared by the @App that installs the plugin', () => {
  test('answers run_workflow, and execute_action through its operation tool', async ({ mcp }) => {
    const workflow = await runWorkflow(mcp, "return await callTool('getAccountPlan', {});");
    const action = await executeAction(mcp, 'getAccountPlan');

    expect(workflow).toMatchObject({ success: true, value: { plan: 'growth', seats: 5 } });
    expect(action.raw.structuredContent).toEqual({ plan: 'growth', seats: 5 });
    expect(environment.billingApi.requests.map((request) => request.authorization)).toEqual([
      `Bearer ${environment.billingToken}`,
      `Bearer ${environment.billingToken}`,
    ]);
  });
});
