/**
 * Authorization of bundle skills and operations, through a real FrontMCP server.
 *
 * 1.8.2 checked `requiredAuthorities` with the plugin's own engine: roles from the
 * token's `roles` claim, whatever the server's `authorities.claimsMapping` said, so a
 * caller the server considers a viewer passed a role check with a stray `roles`
 * claim, and a real admin failed it. `search_skill`, `load_skill` and the catalog in
 * `tools/list` showed every skill, its instructions and its actions to any caller.
 */
import 'reflect-metadata';

import {
  FrontMcpInstance,
  LogLevel,
  Skill,
  type CallToolResult,
  type DirectAuthContext,
  type DirectMcpServer,
} from '@frontmcp/sdk';

import { SkilledOpenApiPlugin } from '../index';

const SERVICE_URL = 'https://203.0.113.10/v1';

const op = (operationId: string, httpMethod: string, pathTemplate: string, extra: Record<string, unknown> = {}) => ({
  operationId,
  serviceId: 'billing',
  httpMethod,
  pathTemplate,
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string' }, amount: { type: 'number' } },
    required: ['id'],
  },
  outputSchema: { type: 'object' },
  mapper: [{ inputKey: 'id', type: 'path', key: 'id', required: true }],
  authBindingRef: 'none',
  summary: `${operationId} summary`,
  ...extra,
});

const ADMIN = { roles: { any: ['admin'] } };

const bundle = {
  schemaVersion: 1,
  bundleId: 'acme:billing',
  version: '1.0.0',
  generatedAt: '2026-09-01T12:00:00.000Z',
  sourceDigest: '0'.repeat(64),
  services: [{ id: 'billing', baseUrl: SERVICE_URL }],
  authBindings: { none: { kind: 'none' } },
  skills: [
    {
      id: 'invoices',
      name: 'Invoices',
      description: 'Look up and refund invoices.',
      instructions: '# Invoices\nUse getInvoice.',
      operationIds: ['getInvoice', 'refundInvoice', 'exportInvoices'],
    },
    {
      id: 'billing-admin',
      name: 'Billing administration',
      description: 'Void invoices.',
      instructions: '# Admin\nSecret runbook: void with voidInvoice.',
      operationIds: ['voidInvoice'],
      requiredAuthorities: ADMIN,
    },
  ],
  operations: {
    getInvoice: op('getInvoice', 'GET', '/invoices/{id}'),
    // Depends on the action's input: can't be judged before the call, so it stays listed.
    refundInvoice: op('refundInvoice', 'POST', '/invoices/{id}/refunds', {
      requiredAuthorities: { attributes: { conditions: [{ path: 'input.amount', op: 'lte', value: 100 }] } },
    }),
    // Needs a role only finance has.
    exportInvoices: op('exportInvoices', 'GET', '/invoices/{id}/export', {
      requiredAuthorities: { roles: { any: ['finance'] } },
    }),
    voidInvoice: op('voidInvoice', 'POST', '/invoices/{id}/void', { requiredAuthorities: ADMIN }),
  },
};

// A viewer, by the server's claimsMapping, with a stray top-level `roles` claim.
const MALLORY: DirectAuthContext = {
  sessionId: 'mallory',
  user: { sub: 'mallory', roles: ['admin', 'finance'], realm_access: { roles: ['viewer'] } },
};
// An admin, by the server's claimsMapping.
const ALICE: DirectAuthContext = {
  sessionId: 'alice',
  user: { sub: 'alice', realm_access: { roles: ['admin'] } },
};

@Skill({ name: 'server-notes', description: 'Notes about this server.', instructions: 'Nothing secret.' })
class ServerNotesSkill {}

@Skill({
  name: 'ops-runbook',
  description: 'Operations runbook.',
  instructions: 'Break-glass procedure.',
  authorities: { roles: { any: ['admin'] } },
})
class OpsRunbookSkill {}

const originalFetch = global.fetch;
const outbound: string[] = [];

let server: DirectMcpServer;

beforeAll(async () => {
  global.fetch = jest.fn(async (url: string | URL | Request) => {
    outbound.push(String(url));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;

  server = await FrontMcpInstance.createDirect({
    info: { name: 'billing', version: '1.0.0' },
    apps: [],
    skills: [ServerNotesSkill, OpsRunbookSkill],
    plugins: [SkilledOpenApiPlugin.init({ source: { type: 'inline', content: bundle }, requireSignature: false })],
    authorities: { claimsMapping: { roles: 'realm_access.roles' } },
    logging: { level: LogLevel.Off },
  } as never);
});

afterAll(async () => {
  global.fetch = originalFetch;
  await server?.dispose();
});

beforeEach(() => {
  outbound.length = 0;
});

const structured = <T>(result: CallToolResult): T => result.structuredContent as T;

async function runWorkflow(caller: DirectAuthContext, script: string) {
  const result = await server.callTool('run_workflow', { script }, { authContext: caller });
  return structured<{ success: boolean; error?: string }>(result);
}

async function loadSkill(caller: DirectAuthContext, skillId: string): Promise<CallToolResult> {
  return server.callTool('load_skill', { skillId }, { authContext: caller });
}

describe('requiredAuthorities use the server authorities settings (claimsMapping)', () => {
  it("refuses an action to a caller whose mapped roles don't satisfy the rule, whatever its `roles` claim says", async () => {
    const result = await runWorkflow(MALLORY, 'return await callTool("voidInvoice", { id: "INV-7" })');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/authority denied/);
    expect(outbound).toEqual([]);
  });

  it('runs the action for a caller whose mapped roles satisfy the rule', async () => {
    const result = await runWorkflow(ALICE, 'return await callTool("voidInvoice", { id: "INV-7" })');

    expect(result).toMatchObject({ success: true });
    expect(outbound).toEqual([`${SERVICE_URL}/invoices/INV-7/void`]);
  });
});

describe('load_skill enforces the skill and its actions', () => {
  it("refuses a skill whose requiredAuthorities the caller doesn't satisfy, as not found", async () => {
    // The direct server throws a tool's error; over MCP it is an error result.
    const outcome = await loadSkill(MALLORY, 'billing-admin').then(
      (result) => ({ result, error: undefined }),
      (error: Error) => ({ result: undefined, error }),
    );

    expect(outcome.result).toBeUndefined();
    expect(outcome.error?.message).toBe('Skill "billing-admin" not found');
  });

  it('loads the skill for a caller who satisfies its requiredAuthorities', async () => {
    const result = await loadSkill(ALICE, 'billing-admin');

    expect(result.isError).toBeFalsy();
    const { skill } = structured<{ skill: { instructions: string; actions: Array<{ actionId: string }> } }>(result);
    expect(skill.instructions).toContain('Secret runbook');
    expect(skill.actions.map((a) => a.actionId)).toEqual(['voidInvoice']);
  });

  it("leaves out the actions the caller can't run, and keeps the ones that depend on the input", async () => {
    const result = await loadSkill(MALLORY, 'invoices');

    const { skill } = structured<{ skill: { actions: Array<{ actionId: string }> } }>(result);
    expect(skill.actions.map((a) => a.actionId)).toEqual(['getInvoice', 'refundInvoice']);
  });
});

describe("load_skill and search_skill apply the server's @Skill authorities too", () => {
  it("refuses an @Skill whose authorities the caller doesn't satisfy, and leaves it out of search", async () => {
    await expect(loadSkill(MALLORY, 'ops-runbook')).rejects.toThrow('Skill "ops-runbook" not found');
    const found = structured<{ skills: Array<{ skillId: string }> }>(
      await server.callTool('search_skill', { query: 'operations runbook' }, { authContext: MALLORY }),
    );
    expect(found.skills.map((s) => s.skillId)).not.toContain('ops-runbook');
  });

  it('loads it for a caller who satisfies them', async () => {
    const { skill } = structured<{ skill: { instructions: string } }>(await loadSkill(ALICE, 'ops-runbook'));
    expect(skill.instructions).toContain('Break-glass');
  });
});

describe('search_skill and the tools/list catalog only show skills the caller may use', () => {
  it("search_skill leaves out a skill whose requiredAuthorities the caller doesn't satisfy", async () => {
    const asMallory = structured<{ skills: Array<{ skillId: string }> }>(
      await server.callTool('search_skill', { query: 'void invoices administration' }, { authContext: MALLORY }),
    );
    const asAlice = structured<{ skills: Array<{ skillId: string }> }>(
      await server.callTool('search_skill', { query: 'void invoices administration' }, { authContext: ALICE }),
    );

    expect(asMallory.skills.map((s) => s.skillId)).not.toContain('billing-admin');
    expect(asAlice.skills.map((s) => s.skillId)).toContain('billing-admin');
  });

  it("the search_skill description in tools/list doesn't name a skill the caller may not use", async () => {
    const describe = async (caller: DirectAuthContext) =>
      (await server.listTools({ authContext: caller })).tools.find((t) => t.name === 'search_skill')?.description ?? '';

    expect(await describe(MALLORY)).not.toContain('Billing administration');
    expect(await describe(ALICE)).toContain('Billing administration');
    // A later caller's catalog must not leak into an earlier one's.
    expect(await describe(MALLORY)).not.toContain('Billing administration');
  });
});

describe("the SDK's skill surfaces hide a bundle skill the caller may not use", () => {
  const ADMIN_SKILL_MD = 'skill://Billing%20administration/SKILL.md';
  const text = (result: Awaited<ReturnType<DirectMcpServer['readResource']>>) =>
    result.contents.map((c) => ('text' in c ? c.text : '')).join('');

  beforeAll(async () => {
    // The bundle loads on the first meta-tool call.
    await server.callTool('search_skill', { query: 'invoices' }, { authContext: ALICE });
  });

  it('skill://index.json lists it only for a caller who satisfies its requiredAuthorities', async () => {
    const asMallory = text(await server.readResource('skill://index.json', { authContext: MALLORY }));
    const asAlice = text(await server.readResource('skill://index.json', { authContext: ALICE }));

    expect(asMallory).toContain('Invoices');
    expect(asMallory).not.toContain('Billing administration');
    expect(asAlice).toContain('Billing administration');
  });

  it("its SKILL.md is not found for a caller who doesn't satisfy its requiredAuthorities", async () => {
    await expect(server.readResource(ADMIN_SKILL_MD, { authContext: MALLORY })).rejects.toThrow(/not found/i);
    expect(text(await server.readResource(ADMIN_SKILL_MD, { authContext: ALICE }))).toContain('Secret runbook');
  });

  it('is refused the same way at the URI with its id', async () => {
    const byId = 'skill://billing-admin/SKILL.md';
    await expect(server.readResource(byId, { authContext: MALLORY })).rejects.toThrow(/not found/i);
    expect(text(await server.readResource(byId, { authContext: ALICE }))).toContain('Secret runbook');
  });
});
