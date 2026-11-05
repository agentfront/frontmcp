// Scenarios G1 G2 E6: a skill a skills:filter hook hides from one caller can't be run by naming its actions; another caller still runs them.
import { expect, test } from '@frontmcp/testing';

import { ProductionEnvironment } from './helpers/production-environment';
import {
  actionIdsOf,
  executeAction,
  loadSkill,
  onPlan,
  runWorkflow,
  searchSkillIds,
  SKILLED_SERVER,
} from './helpers/skilled-client';

const environment = new ProductionEnvironment();

test.use({
  ...SKILLED_SERVER,
  server: 'apps/e2e/demo-e2e-skilled-openapi/src/skill-filter.main.ts',
  env: environment.env,
});
test.beforeAll(() => environment.start());
test.afterAll(() => environment.stop());
test.beforeEach(() => environment.billingApi.reset());

const ACCOUNT_PLAN_SCRIPT = "return await callTool('getAccountPlan', {});";
const UNKNOWN_ACCOUNT_PLAN =
  'unknown action "getAccountPlan" — run search_skill then load_skill to discover available actions';
const REPORTS_QUERY = { query: 'revenue reports account plan usage' };

test.describe('a skill a skills:filter hook hides from a caller on the free plan', () => {
  test('is neither loaded nor found for that caller, and is for another', async ({ server, auth }) => {
    const freePlan = await onPlan({ server, auth }, 'fiona', 'free');
    const proPlan = await onPlan({ server, auth }, 'paul', 'pro');

    expect(await loadSkill(freePlan, 'reports')).toBeUndefined();
    expect(await searchSkillIds(freePlan, REPORTS_QUERY)).not.toContain('reports');
    expect(actionIdsOf(await loadSkill(proPlan, 'reports'))).toContain('getAccountPlan');
    expect(await searchSkillIds(proPlan, REPORTS_QUERY)).toContain('reports');
  });

  test('refuses its actions to that caller, by run_workflow and execute_action, as unknown, sending nothing', async ({
    server,
    auth,
  }) => {
    const freePlan = await onPlan({ server, auth }, 'fiona', 'free');

    const workflow = await runWorkflow(freePlan, ACCOUNT_PLAN_SCRIPT);
    const action = await executeAction(freePlan, 'getAccountPlan');

    expect(workflow).toMatchObject({ success: false, error: UNKNOWN_ACCOUNT_PLAN });
    expect(action.isError).toBe(true);
    expect(action.text()).toBe(UNKNOWN_ACCOUNT_PLAN);
    expect(environment.billingApi.requests).toEqual([]);
  });

  test('still runs them for a caller on another plan', async ({ server, auth }) => {
    const proPlan = await onPlan({ server, auth }, 'paul', 'pro');

    const workflow = await runWorkflow(proPlan, ACCOUNT_PLAN_SCRIPT);
    const action = await executeAction(proPlan, 'getAccountPlan');

    expect(workflow).toMatchObject({ success: true, value: { plan: 'growth', seats: 5 } });
    expect(action.raw.structuredContent).toEqual({ plan: 'growth', seats: 5 });
    expect(environment.billingApi.requests.map((request) => request.path)).toEqual([
      '/v1/account/plan',
      '/v1/account/plan',
    ]);
  });
});
