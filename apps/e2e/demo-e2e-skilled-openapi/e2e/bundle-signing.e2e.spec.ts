// Scenario A3: with requireSignature, a bundle signed by a trusted key is applied, and one changed after signing is not.
import { expect, test } from '@frontmcp/testing';

import { ProductionEnvironment } from './helpers/production-environment';
import { loadSkill, searchSkillIds, SKILLED_SERVER } from './helpers/skilled-client';

const environment = new ProductionEnvironment();

test.use({ ...SKILLED_SERVER, env: environment.env });
test.beforeAll(() => environment.start());
test.afterAll(() => environment.stop());

test.describe('a bundle signed with a trusted key', () => {
  test('is applied: its skills are served and its actions run', async ({ mcp }) => {
    const result = await mcp.tools.call('run_workflow', {
      script: "return await callTool('createInvoice', { customerId: 'cus_e2e', amount: 10 });",
    });

    expect(await loadSkill(mcp, 'invoices')).toMatchObject({ id: 'invoices', bundleVersion: '1.0.0' });
    expect((await searchSkillIds(mcp, { query: 'billing' })).sort()).toEqual(['invoices', 'reports']);
    expect(result.json()).toMatchObject({ success: true, value: { status: 'open' } });
  });
});

test.describe('a bundle changed after it was signed', () => {
  test.use({ env: environment.tamperedBundleEnv });

  test('is not applied: the server serves none of its skills, and logs why', async ({ mcp, server }) => {
    const loaded = await mcp.tools.call('load_skill', { skillId: 'billing-admin' });

    expect(loaded.text()).toBe('Skill "billing-admin" not found');
    expect(await searchSkillIds(mcp, { query: 'billing' })).toEqual([]);
    expect((await mcp.tools.list()).map((tool) => tool.name).sort()).toEqual([
      'load_skill',
      'run_workflow',
      'search_skill',
    ]);
    expect(server.getLogs().join('\n')).toMatch(/rejected bundle e2e:billing@1\.0\.0: digest mismatch/);
  });
});
