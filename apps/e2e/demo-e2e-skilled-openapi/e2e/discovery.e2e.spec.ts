// Scenarios C1 C2 C3 C5 D1 G2: what anonymous, viewer and admin callers discover on a server with the production settings.
import { expect, test, type McpTestClient } from '@frontmcp/testing';

import { ProductionEnvironment } from './helpers/production-environment';
import {
  actionIdsOf,
  asAdmin,
  asViewer,
  loadSkill,
  searchSkillIds,
  SKILLED_SERVER,
  type LoadSkillResponse,
} from './helpers/skilled-client';

const ADMIN_SKILL_NAME = 'Billing administration';

const environment = new ProductionEnvironment();

test.use({ ...SKILLED_SERVER, env: environment.env });
test.beforeAll(() => environment.start());
test.afterAll(() => environment.stop());

async function searchSkillCatalog(client: McpTestClient): Promise<string> {
  const tools = await client.tools.list();
  return tools.find((tool) => tool.name === 'search_skill')?.description ?? '';
}

async function indexedSkillNames(client: McpTestClient): Promise<string[]> {
  const index = (await client.resources.read('skill://index.json')).json<{
    skills: Array<{ type: string; name?: string }>;
  }>();
  return index.skills.filter((entry) => entry.type === 'skill-md').map((entry) => entry.name ?? '');
}

function skillMdActionIds(skillMd: string): string[] {
  return [...skillMd.matchAll(/^### (\S+)$/gm)].map((match) => match[1]);
}

test.describe('tools/list (C1)', () => {
  test('lists exactly search_skill, load_skill and run_workflow, and no bundle operation', async ({
    mcp,
    server,
    auth,
  }) => {
    const names = (await mcp.tools.list()).map((tool) => tool.name).sort();
    const adminNames = (await (await asAdmin({ server, auth })).tools.list()).map((tool) => tool.name).sort();

    expect(names).toEqual(['load_skill', 'run_workflow', 'search_skill']);
    expect(adminNames).toEqual(names);
  });

  test("search_skill's catalog names only the skills the caller may use (G2)", async ({ mcp, server, auth }) => {
    const anonymousCatalog = await searchSkillCatalog(mcp);
    const viewerCatalog = await searchSkillCatalog(await asViewer({ server, auth }));
    const adminCatalog = await searchSkillCatalog(await asAdmin({ server, auth }));

    expect(anonymousCatalog).toContain('- **Invoices**: Issue, query, and refund invoices');
    expect(anonymousCatalog).toContain('- **Reports**: Revenue and usage reports');
    expect(anonymousCatalog).not.toContain(ADMIN_SKILL_NAME);
    expect(viewerCatalog).not.toContain(ADMIN_SKILL_NAME);
    expect(adminCatalog).toContain(`- **${ADMIN_SKILL_NAME}**: Look up and void invoices`);
  });
});

test.describe('initialize instructions (C2)', () => {
  test('count the skills the caller may use and point to load_skill and search_skill', async ({
    mcp,
    server,
    auth,
  }) => {
    const pointers = 'load one by name with `load_skill`, or find one with `search_skill`.';

    expect(mcp.instructions).toBe(`This server has 2 skills: ${pointers}`);
    expect((await asViewer({ server, auth })).instructions).toBe(`This server has 2 skills: ${pointers}`);
    expect((await asAdmin({ server, auth })).instructions).toBe(`This server has 3 skills: ${pointers}`);
  });
});

test.describe('search_skill (C3)', () => {
  test("finds a skill by its description, an operation's summary and an operation id", async ({ mcp }) => {
    expect(await searchSkillIds(mcp, { query: 'refund invoice' })).toEqual(['invoices']);
    expect(await searchSkillIds(mcp, { query: 'monthly totals' })).toEqual(['reports']);
    expect(await searchSkillIds(mcp, { query: 'getAccountBalance' })).toEqual(['reports']);
    expect(await searchSkillIds(mcp, { query: 'listInvoiceEvents' })).toEqual(['invoices']);
  });

  test('keeps only the skills carrying a tag the tags filter names', async ({ mcp }) => {
    expect((await searchSkillIds(mcp, { query: 'billing' })).sort()).toEqual(['invoices', 'reports']);
    expect(await searchSkillIds(mcp, { query: 'billing', tags: ['reports'] })).toEqual(['reports']);
  });

  test('demotes the skills matching notQuery', async ({ mcp }) => {
    expect(await searchSkillIds(mcp, { query: 'billing', notQuery: 'revenue' })).toEqual(['invoices']);
  });

  test('returns at most limit skills', async ({ mcp }) => {
    expect(await searchSkillIds(mcp, { query: 'billing', limit: 1 })).toHaveLength(1);
  });

  test('leaves out a skill whose rule the caller does not satisfy (G2)', async ({ mcp, server, auth }) => {
    const query = { query: 'void invoices administration' };

    expect(await searchSkillIds(mcp, query)).not.toContain('billing-admin');
    expect(await searchSkillIds(await asViewer({ server, auth }), query)).not.toContain('billing-admin');
    expect(await searchSkillIds(await asAdmin({ server, auth }), query)).toContain('billing-admin');
  });
});

test.describe('load_skill (D1)', () => {
  test('loads a skill by the name the catalog shows, with its instructions, actions and bundleVersion', async ({
    mcp,
  }) => {
    const skill = await loadSkill(mcp, 'Invoices');

    expect(skill).toMatchObject({ id: 'invoices', name: 'Invoices', bundleVersion: '1.0.0' });
    expect(skill?.instructions).toContain('# Invoices skill');
    expect(actionIdsOf(skill)).toEqual([
      'createInvoice',
      'getInvoice',
      'listInvoiceEvents',
      'listInvoices',
      'refundInvoice',
    ]);
  });

  test('loads a skill by id, without the operation unprotectedOps "deny" blocks (G2)', async ({ mcp }) => {
    const skill = await loadSkill(mcp, 'reports');

    expect(skill).toMatchObject({ id: 'reports', name: 'Reports', bundleVersion: '1.0.0' });
    expect(actionIdsOf(skill)).toEqual([
      'exportRevenueReport',
      'getAccountBalance',
      'getAccountPlan',
      'getRevenueReport',
    ]);
  });

  test('loads several skills with skillIds, each once, in the order asked for', async ({ mcp }) => {
    const result = await mcp.tools.call('load_skill', { skillIds: ['invoices', 'Reports', 'invoices'] });

    expect(result).toBeSuccessful();
    const loaded = result.json<LoadSkillResponse>().skills ?? [];
    expect(loaded.map((entry) => entry.skill.id)).toEqual(['invoices', 'reports']);
    expect(loaded.map((entry) => entry.skill.bundleVersion)).toEqual(['1.0.0', '1.0.0']);
  });

  test('answers a skill the caller may not see as not found, like an unknown one (G2)', async ({
    mcp,
    server,
    auth,
  }) => {
    const refused = await mcp.tools.call('load_skill', { skillId: 'billing-admin' });
    const refusedToViewer = await (
      await asViewer({ server, auth })
    ).tools.call('load_skill', {
      skillId: 'billing-admin',
    });
    const unknown = await mcp.tools.call('load_skill', { skillId: 'does-not-exist' });

    expect(refused.isError).toBe(true);
    expect(refused.text()).toBe('Skill "billing-admin" not found');
    expect(refusedToViewer.text()).toBe('Skill "billing-admin" not found');
    expect(unknown.text()).toBe('Skill "does-not-exist" not found');
  });

  test('loads the gated skill for a caller with the role', async ({ server, auth }) => {
    const skill = await loadSkill(await asAdmin({ server, auth }), 'billing-admin');

    expect(skill).toMatchObject({ id: 'billing-admin', name: ADMIN_SKILL_NAME, bundleVersion: '1.0.0' });
    expect(actionIdsOf(skill)).toEqual(['adminPing', 'getInvoice', 'voidInvoice']);
  });
});

test.describe('skill:// resources (C5)', () => {
  test('resources/list lists the SKILL.md of the skills the caller may use (G2)', async ({ mcp, server, auth }) => {
    const anonymousUris = (await mcp.resources.list()).map((resource) => resource.uri).sort();
    const adminUris = (await (await asAdmin({ server, auth })).resources.list()).map((resource) => resource.uri).sort();

    expect(anonymousUris).toEqual(['skill://Invoices/SKILL.md', 'skill://Reports/SKILL.md', 'skill://index.json']);
    expect(adminUris).toEqual([
      'skill://Billing%20administration/SKILL.md',
      'skill://Invoices/SKILL.md',
      'skill://Reports/SKILL.md',
      'skill://index.json',
    ]);
  });

  test('skill://index.json lists the skills the caller may use (G2)', async ({ mcp, server, auth }) => {
    expect(await indexedSkillNames(mcp)).toEqual(['Invoices', 'Reports']);
    expect(await indexedSkillNames(await asViewer({ server, auth }))).toEqual(['Invoices', 'Reports']);
    expect(await indexedSkillNames(await asAdmin({ server, auth }))).toEqual([ADMIN_SKILL_NAME, 'Invoices', 'Reports']);
  });

  test('SKILL.md has an Actions section listing the actions the caller may run, as load_skill does', async ({
    mcp,
  }) => {
    const skillMd = (await mcp.resources.read('skill://Reports/SKILL.md')).text() ?? '';

    expect(skillMd).toMatch(/^---\nname: Reports\n/);
    expect(skillMd).toContain(
      '## Actions\n\nRun these with `run_workflow`: in its script, `await callTool(actionId, input)` calls an action',
    );
    expect(skillMdActionIds(skillMd)).toEqual([
      'getRevenueReport',
      'exportRevenueReport',
      'getAccountBalance',
      'getAccountPlan',
    ]);
  });

  test("a gated skill's SKILL.md is not found for a caller without the role, by name or by id (G2)", async ({
    mcp,
    server,
    auth,
  }) => {
    const admin = await asAdmin({ server, auth });

    for (const uri of ['skill://Billing%20administration/SKILL.md', 'skill://billing-admin/SKILL.md']) {
      const refused = await mcp.resources.read(uri);
      expect(refused.isError).toBe(true);
      expect(refused.error?.message).toMatch(/Resource not found/);

      const skillMd = (await admin.resources.read(uri)).text() ?? '';
      expect(skillMdActionIds(skillMd)).toEqual(['getInvoice', 'voidInvoice', 'adminPing']);
    }
  });
});
