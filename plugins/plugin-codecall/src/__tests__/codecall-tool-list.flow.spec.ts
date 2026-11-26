/**
 * What CodeCall lists in tools/list, as a client sees it: the whole list stays within a budget for a fixed tool set,
 * and every result its tools give validates against the outputSchema they list, with `validateStructuredContent:
 * 'enforce'` and `undeclaredKeys: 'fail'`, so nothing a result carries is refused or dropped.
 */
import 'reflect-metadata';

import { ApprovalPlugin } from '@frontmcp/plugin-approval';
import { App, connect, LogLevel, Tool, ToolContext, z, type CallToolResult, type DirectClient } from '@frontmcp/sdk';

import CodeCallPlugin from '../codecall.plugin';
import type { CodeCallPluginOptionsInput } from '../codecall.types';

jest.setTimeout(60000);

/** The JSON bytes of tools/list for the 47-tool fixture: 18,517 without review or budgets, 19,690 with them. */
const TOOL_LIST_BUDGETS = { default: 19_500, everything: 20_700 };

const ENTITIES = [
  'contacts',
  'companies',
  'deals',
  'tasks',
  'notes',
  'meetings',
  'emails',
  'pipelines',
  'products',
  'quotes',
];
const CRM_TOOL_NAMES = ENTITIES.flatMap((entity) =>
  ['list', 'get', 'create', 'update', 'delete'].map((verb) => `${entity}:${verb}`),
).slice(0, 47);

function crmTool(name: string) {
  @Tool({
    name,
    description: `${name.replace(':', ' ')} in the CRM, with the fields the CRM keeps for it`,
    inputSchema: { id: z.string().optional(), limit: z.number().int().optional(), query: z.string().optional() },
  })
  class CrmTool extends ToolContext {
    async execute({ id }: { id?: string; limit?: number; query?: string }) {
      return { id };
    }
  }
  return CrmTool;
}

@Tool({ name: 'items.list', description: 'Lists items', inputSchema: {}, annotations: { readOnlyHint: true } })
class ListItemsTool extends ToolContext {
  async execute() {
    return { items: [{ id: 'i1' }] };
  }
}

@Tool({ name: 'items.fail', description: 'Fails', inputSchema: {} })
class FailItemsTool extends ToolContext {
  async execute(): Promise<never> {
    throw new Error('the item store is down');
  }
}

@Tool({ name: 'items.slow', description: 'Takes longer than a script may', inputSchema: {} })
class SlowItemsTool extends ToolContext {
  async execute() {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return { done: true };
  }
}

@Tool({
  name: 'items.count',
  description: 'Counts items',
  inputSchema: { limit: z.number().int().positive() },
  annotations: { readOnlyHint: true },
})
class CountItemsTool extends ToolContext {
  async execute({ limit }: { limit: number }) {
    return { count: limit };
  }
}

@Tool({
  name: 'items.close',
  description: 'Closes an item for good',
  inputSchema: { id: z.string() },
  annotations: { destructiveHint: true },
})
class CloseItemTool extends ToolContext {
  async execute({ id }: { id: string }) {
    return { closed: id };
  }
}

@Tool({
  name: 'approvals.grant',
  description: 'Grants a CodeCall approval for this session',
  inputSchema: { id: z.string() },
  codecall: { visibleInListTools: true, enabledInCodeCall: false },
})
class GrantApprovalTool extends ToolContext {
  async execute({ id }: { id: string }) {
    await this.approval.grantSessionApproval(id);
    return { granted: id };
  }
}

const ITEM_TOOLS = [ListItemsTool, FailItemsTool, SlowItemsTool, CountItemsTool, CloseItemTool, GrantApprovalTool];

function serverConfig(tools: unknown[], options: CodeCallPluginOptionsInput) {
  @App({
    id: 'desk',
    name: 'Desk',
    tools: tools as never,
    plugins: [
      CodeCallPlugin.init({ mode: 'codecall_only', ...options }),
      ApprovalPlugin.init({ storage: { type: 'memory' } }),
    ],
  })
  class DeskApp {}

  return {
    info: { name: 'codecall-tool-list', version: '1.0.0' },
    apps: [DeskApp],
    logging: { level: LogLevel.Off },
    output: { validateStructuredContent: 'enforce' as const, undeclaredKeys: 'fail' as const },
  };
}

const BUDGETS = (onExceeded: 'needs_approval' | 'denied') => ({
  limits: [{ name: 'calls', counts: 'toolCalls' as const, limit: 1, windowSeconds: 3600, onExceeded }],
  storage: { type: 'memory' as const },
});

const clients: DirectClient[] = [];

async function open(config: ReturnType<typeof serverConfig>): Promise<DirectClient> {
  const client = await connect(config, { session: { id: `list-${clients.length}`, user: { sub: 'ada' } } });
  clients.push(client);
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function listedTools(client: DirectClient): Promise<Array<Record<string, unknown>>> {
  return (await client.listTools()) as unknown as Array<Record<string, unknown>>;
}

/** Calls the tool and checks its structuredContent against the outputSchema it lists, as a client would. */
async function answerOf(client: DirectClient, tool: string, args: Record<string, unknown>) {
  const listed = (await listedTools(client)).find((entry) => entry['name'] === tool);
  const result = (await client.callTool(tool, args)) as CallToolResult;
  expect(result.isError).not.toBe(true);
  const answer = result.structuredContent as Record<string, unknown>;
  const valid = z.fromJSONSchema(listed?.['outputSchema'] as Record<string, unknown>).safeParse(answer);
  expect(valid.success).toBe(true);
  return answer;
}

const execute = (client: DirectClient, script: string, extra: Record<string, unknown> = {}) =>
  answerOf(client, 'codecall:execute', { script, ...extra });

describe('the size of tools/list in codecall_only', () => {
  it.each([
    ['default', {}],
    [
      'everything',
      {
        review: {},
        budgets: BUDGETS('needs_approval'),
        directCalls: { enabled: true },
      },
    ],
  ] as const)('stays within its budget with %s options', async (label, options) => {
    const client = await open(serverConfig(CRM_TOOL_NAMES.map(crmTool), options as CodeCallPluginOptionsInput));

    const bytes = Buffer.byteLength(JSON.stringify(await listedTools(client)), 'utf8');

    expect(bytes).toBeLessThanOrEqual(TOOL_LIST_BUDGETS[label]);
  });
});

describe('every CodeCall result validates against the outputSchema its tool lists', () => {
  it('for ok, with kept names and a trace, and for each kind of error', async () => {
    const client = await open(
      serverConfig(ITEM_TOOLS, { vm: { preset: 'secure', timeoutMs: 500 }, trace: { level: 'calls' } }),
    );

    expect(
      await execute(client, "const page = await callTool('items.list', {});\nawait keep('page', page);\nreturn page;"),
    ).toMatchObject({
      status: 'ok',
      result: { items: [{ id: 'i1' }] },
      kept: ['page'],
      trace: expect.arrayContaining([expect.any(String)]),
    });
    expect(await execute(client, 'const broken = (;\nreturn broken;')).toMatchObject({
      status: 'syntax_error',
      error: { message: expect.any(String), location: { line: 1 } },
    });
    expect(await execute(client, "const value = eval('1');\nreturn value;")).toMatchObject({
      status: 'illegal_access',
      error: { kind: expect.any(String) },
    });
    expect(await execute(client, "const reason = 'stop here';\nthrow new Error(reason);")).toMatchObject({
      status: 'runtime_error',
      error: { source: 'script', message: expect.stringContaining('stop here') },
    });
    expect(await execute(client, "return await callTool('items.fail', {});")).toMatchObject({
      status: 'tool_error',
      error: { source: 'tool', toolName: 'items.fail', code: expect.any(String) },
    });
    expect(await execute(client, "return await callTool('items.slow', {});")).toMatchObject({ status: 'timeout' });
  });

  it("for the review's decisions, a pause, its resume, and a run's status and cancel", async () => {
    const client = await open(serverConfig(ITEM_TOOLS, { review: {} }));

    expect(await execute(client, "return await callTool('items.count', { limit: 'all' });")).toMatchObject({
      status: 'needs_changes',
      findings: [{ rule: expect.any(String), message: expect.any(String) }],
    });
    expect(await execute(client, "return await callTool('items.close', { id: 'i1' });")).toMatchObject({
      status: 'needs_approval',
      approval: { id: expect.any(String), toolName: 'items.close' },
    });
    expect(
      await execute(client, "return await callTool('items.close', { id: 'i1' });", { allowedTools: ['items.list'] }),
    ).toMatchObject({ status: 'denied', reason: expect.any(String) });

    const script =
      "const page = await callTool('items.list', {});\nreturn await callTool('items.close', { id: page.items[0].id });";
    const paused = await execute(client, script);
    expect(paused).toMatchObject({
      status: 'needs_approval',
      runId: expect.any(String),
      paused: { call: { position: 2, tool: 'items.close' }, expiresAt: expect.any(String) },
    });
    const runId = paused['runId'] as string;
    expect(await answerOf(client, 'codecall:status', { runId })).toMatchObject({
      status: 'paused',
      paused: { call: { position: 2 } },
    });
    await client.callTool('approvals.grant', { id: (paused['approval'] as { id: string }).id });
    expect(await answerOf(client, 'codecall:resume', { runId })).toMatchObject({
      status: 'ok',
      result: { closed: 'i1' },
      runId,
    });

    const cancelled = await execute(client, script.replace('page.items[0].id', "page.items[0].id + '-copy'"));
    expect(await answerOf(client, 'codecall:cancel', { runId: cancelled['runId'] as string })).toMatchObject({
      status: 'cancelled',
    });
  });

  it('for a review that failed', async () => {
    const reviewer = async () => {
      throw new Error('the review service is unreachable');
    };
    const client = await open(serverConfig(ITEM_TOOLS, { review: { rules: false, reviewer, policy: 'Read only' } }));

    expect(await execute(client, "return await callTool('items.list', {});")).toMatchObject({
      status: 'review_failed',
      error: { message: expect.any(String) },
    });
  });

  it.each(['needs_approval', 'denied'] as const)('for a budget that answers %s', async (onExceeded) => {
    const client = await open(serverConfig(ITEM_TOOLS, { budgets: BUDGETS(onExceeded) }));
    await execute(client, "return await callTool('items.list', {});");

    expect(await execute(client, "return await callTool('items.list', {});")).toMatchObject({
      status: onExceeded,
      reason: expect.stringContaining('calls'),
      findings: [{ rule: 'budget-exceeded', toolName: 'items.list' }],
    });
  });
});
