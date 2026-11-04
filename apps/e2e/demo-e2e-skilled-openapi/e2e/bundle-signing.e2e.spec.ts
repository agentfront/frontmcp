// Scenarios A3 B1 B4: with requireSignature, a bundle signed by a trusted key is applied, from JSON or YAML, and one
// changed after signing is not: the tools and /readyz say why.
import { expect, test } from '@frontmcp/testing';
import { readFile } from '@frontmcp/utils';

import { ProductionEnvironment } from './helpers/production-environment';
import { loadSkill, runWorkflow, searchSkillIds, SKILLED_SERVER } from './helpers/skilled-client';

interface Readiness {
  httpStatus: number;
  status: string;
  probes?: Record<string, { status: string; details?: Record<string, unknown>; error?: string }>;
}

async function readiness(baseUrl: string): Promise<Readiness> {
  const response = await fetch(`${baseUrl}/readyz`);
  return { httpStatus: response.status, ...((await response.json()) as Omit<Readiness, 'httpStatus'>) };
}

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

  test('is reported on /readyz by its id and version', async ({ server }) => {
    const ready = await readiness(server.info.baseUrl);

    expect(ready).toMatchObject({ httpStatus: 200, status: 'ready' });
    expect(ready.probes?.['skilled-openapi']).toEqual({
      status: 'healthy',
      details: { state: 'loaded', bundleId: 'e2e:billing', bundleVersion: '1.0.0' },
    });
  });
});

test.describe('a signed bundle written as YAML, with generatedAt unquoted', () => {
  test.use({ env: environment.yamlBundleEnv });

  test('is applied: its signature verifies, and its skills are served', async ({ mcp }) => {
    const bundleYaml = await readFile(environment.yamlBundleEnv['SKILLED_BUNDLE_PATH']);

    const workflow = await runWorkflow(
      mcp,
      "return await callTool('createInvoice', { customerId: 'cus_e2e', amount: 10 });",
    );

    expect(bundleYaml).toMatch(/^generatedAt: 2026-05-04T12:00:00\.000Z$/m);
    expect(await loadSkill(mcp, 'invoices')).toMatchObject({ id: 'invoices', bundleVersion: '1.0.0' });
    expect((await searchSkillIds(mcp, { query: 'billing' })).sort()).toEqual(['invoices', 'reports']);
    expect(workflow).toMatchObject({ success: true, value: { status: 'open' } });
  });
});

test.describe('a bundle changed after it was signed', () => {
  test.use({ env: environment.tamperedBundleEnv });

  test('is not applied: the meta-tools say why, and /readyz is not ready', async ({ mcp, server }) => {
    const reason = /^No skill bundle is loaded: bundle e2e:billing@1\.0\.0 was not applied: digest mismatch \(/;

    const searched = await mcp.tools.call('search_skill', { query: 'billing' });
    const loaded = await mcp.tools.call('load_skill', { skillId: 'invoices' });
    const executed = await mcp.tools.call('execute_action', { actionId: 'getInvoice', input: { id: 'inv_1' } });
    const ran = await mcp.tools.call('run_workflow', { script: 'return 1' });
    const ready = await readiness(server.info.baseUrl);

    expect([searched.isError, loaded.isError, executed.isError, ran.isError]).toEqual([true, true, true, true]);
    expect(searched.text()).toMatch(reason);
    expect(loaded.text()).toBe(searched.text());
    expect(executed.text()).toBe(searched.text());
    expect(ran.text()).toBe(searched.text());
    expect((await mcp.tools.list()).map((tool) => tool.name).sort()).toEqual([
      'execute_action',
      'load_skill',
      'run_workflow',
      'search_skill',
    ]);
    expect(ready).toMatchObject({ httpStatus: 503, status: 'not_ready' });
    expect(ready.probes?.['skilled-openapi']).toMatchObject({
      status: 'unhealthy',
      error: expect.stringMatching(
        /^no skill bundle is loaded: bundle e2e:billing@1\.0\.0 was not applied: digest mismatch/,
      ),
    });
    expect(server.getLogs().join('\n')).toMatch(/rejected bundle e2e:billing@1\.0\.0: digest mismatch/);
  });
});
