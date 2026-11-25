/** `budgets` through a real server: a caller over a budget is stopped before the call runs, and another goes on. */
import 'reflect-metadata';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ApprovalPlugin } from '@frontmcp/plugin-approval';
import {
  App,
  connect,
  InvalidInputError,
  LogLevel,
  Tool,
  ToolContext,
  z,
  type CallToolResult,
  type ConnectOptions,
  type DirectClient,
} from '@frontmcp/sdk';
import { mkdtemp, rm } from '@frontmcp/utils';

import { BUDGET_EXCEEDED_RULE } from '../budgets/budget-meter';
import CodeCallPlugin from '../codecall.plugin';
import type { CodeCallPluginOptionsInput, CodeCallVmRuntime } from '../codecall.types';
import { CodeCallRunStoreToken, type CodeCallRunRecord } from '../runs/run-record.types';

jest.setTimeout(30000);

const executed: string[] = [];

@Tool({
  name: 'tickets.get',
  description: 'Gets a ticket',
  inputSchema: { id: z.number() },
  annotations: { readOnlyHint: true },
})
class GetTicketTool extends ToolContext {
  async execute({ id }: { id: number }) {
    executed.push(`tickets.get:${id}`);
    return { id };
  }
}

@Tool({ name: 'tickets.archive', description: 'Archives tickets', inputSchema: { ids: z.array(z.string()) } })
class ArchiveTicketsTool extends ToolContext {
  async execute({ ids }: { ids: string[] }) {
    executed.push(`tickets.archive:${ids.length}`);
    this.reportRecordsChanged(ids.length);
    return { archived: ids.length };
  }
}

@Tool({
  name: 'tickets.echo',
  description: 'Returns what it is sent',
  inputSchema: { note: z.record(z.string(), z.unknown()) },
  annotations: { readOnlyHint: true },
})
class EchoTool extends ToolContext {
  async execute({ note }: { note: Record<string, unknown> }) {
    executed.push('tickets.echo');
    return note;
  }
}

@Tool({
  name: 'tickets.delete',
  description: 'Deletes a ticket for good',
  inputSchema: { id: z.number() },
  annotations: { destructiveHint: true },
})
class DeleteTicketTool extends ToolContext {
  async execute({ id }: { id: number }) {
    executed.push(`tickets.delete:${id}`);
    return { deleted: id };
  }
}

@Tool({ name: 'tickets.reject', description: 'Refuses a ticket from inside the tool', inputSchema: {} })
class RejectTicketTool extends ToolContext {
  async execute(): Promise<never> {
    executed.push('tickets.reject');
    throw new InvalidInputError('the ticket is closed');
  }
}

@Tool({
  name: 'tickets.purge',
  description: 'Purges tickets slowly, past its own timeout',
  inputSchema: {},
  timeout: { executeMs: 50 },
})
class SlowPurgeTool extends ToolContext {
  async execute() {
    await new Promise((resolve) => setTimeout(resolve, 150));
    executed.push('tickets.purge');
    this.reportRecordsChanged(250);
    return { purged: 250 };
  }
}

@Tool({
  name: 'approvals.grant',
  description: 'Grants a CodeCall approval for this session, as a person would through the server',
  inputSchema: { id: z.string() },
  codecall: { visibleInListTools: true, enabledInCodeCall: false },
})
class GrantApprovalTool extends ToolContext {
  async execute({ id }: { id: string }) {
    await this.approval.grantSessionApproval(id);
    return { granted: id };
  }
}

@Tool({
  name: 'runs.read',
  description: 'Reads a run record',
  inputSchema: { runId: z.string() },
  codecall: { visibleInListTools: true, enabledInCodeCall: false },
})
class ReadRunTool extends ToolContext {
  async execute({ runId }: { runId: string }) {
    return { record: (await this.get(CodeCallRunStoreToken).read(runId, this)) ?? null };
  }
}

interface ExecuteOutcome {
  status: string;
  runId?: string;
  result?: unknown;
  reason?: string;
  approval?: { id: string; toolName?: string; argumentsHash?: string; anyArgumentsId?: string };
  findings?: Array<{ rule: string; message: string; toolName?: string }>;
}

function serverConfig(options: CodeCallPluginOptionsInput, { approvalPlugin = true, elicitation = false } = {}) {
  @App({
    id: 'desk',
    name: 'Desk',
    tools: [
      GetTicketTool,
      ArchiveTicketsTool,
      EchoTool,
      DeleteTicketTool,
      RejectTicketTool,
      SlowPurgeTool,
      GrantApprovalTool,
      ReadRunTool,
    ],
    plugins: [
      CodeCallPlugin.init({ mode: 'codecall_only', ...options }),
      ...(approvalPlugin ? [ApprovalPlugin.init({ storage: { type: 'memory' } })] : []),
    ],
  })
  class DeskApp {}

  return {
    info: { name: 'codecall-budgets', version: '1.0.0' },
    apps: [DeskApp],
    logging: { level: LogLevel.Off },
    ...(elicitation && { elicitation: { enabled: true } }),
  };
}

function structuredOf<T>(result: CallToolResult): T {
  if (result.structuredContent) return result.structuredContent as T;
  const [first] = result.content;
  if (first?.type !== 'text') throw new Error('the tool returned no text content');
  return JSON.parse(first.text) as T;
}

const clients: DirectClient[] = [];

async function open(
  config: ReturnType<typeof serverConfig>,
  subject: string,
  options: ConnectOptions = {},
): Promise<DirectClient> {
  const session = { id: `${subject}-${clients.length}`, user: { sub: subject } };
  const client = await connect(config, { session, ...options });
  clients.push(client);
  return client;
}

async function execute(client: DirectClient, script: string): Promise<ExecuteOutcome> {
  return structuredOf<ExecuteOutcome>((await client.callTool('codecall:execute', { script })) as CallToolResult);
}

async function readRun(client: DirectClient, runId: string): Promise<CodeCallRunRecord | null> {
  return structuredOf<{ record: CodeCallRunRecord | null }>(
    (await client.callTool('runs.read', { runId })) as CallToolResult,
  ).record;
}

async function executeDescriptionOf(client: DirectClient): Promise<string> {
  const tools = (await client.listTools()) as Array<{ name: string; description?: string }>;
  return tools.find((tool) => tool.name === 'codecall:execute')?.description ?? '';
}

const accept: ConnectOptions['onElicitation'] = async () => ({ action: 'accept', content: { approve: true } });
const THREE_GETS = "for (const id of [1, 2, 3]) {\n  await callTool('tickets.get', { id });\n}";

const threeCallsPerHour = (onExceeded?: 'needs_approval' | 'denied') => ({
  limits: [{ name: 'calls-per-hour', counts: 'toolCalls' as const, limit: 3, windowSeconds: 3600, onExceeded }],
  storage: { type: 'memory' as const },
});

const RECORDS_PER_HOUR = {
  limits: [{ name: 'records-per-hour', counts: 'recordsChanged' as const, limit: 200, windowSeconds: 3600 }],
  storage: { type: 'memory' as const },
};

const RUNTIMES: CodeCallVmRuntime[] = ['node-vm', 'interpreter'];
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'codecall-budgets-'));
});

beforeEach(() => {
  executed.length = 0;
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe.each(RUNTIMES)('CodeCall budgets on the %s runtime', (runtime) => {
  describe.each([
    ['without review', undefined],
    ['with review', {}],
  ])('%s', (_, review) => {
    it('stops a caller over a budget with needs_approval before the call runs, and not another caller', async () => {
      const config = serverConfig({ vm: { preset: 'secure', runtime }, review, budgets: threeCallsPerHour() });
      const ada = await open(config, 'ada');
      const bob = await open(config, 'bob');

      const outcome = await execute(
        ada,
        "for (const id of [1, 2, 3, 4]) {\n  await callTool('tickets.get', { id });\n}\nreturn 'done';",
      );

      expect(outcome).toMatchObject({ status: 'needs_approval', reason: expect.stringContaining('calls-per-hour') });
      expect(outcome.findings).toEqual([
        expect.objectContaining({ rule: BUDGET_EXCEEDED_RULE, toolName: 'tickets.get' }),
      ]);
      expect(executed).toEqual(['tickets.get:1', 'tickets.get:2', 'tickets.get:3']);
      expect(await execute(bob, "return await callTool('tickets.get', { id: 9 });")).toMatchObject({
        status: 'ok',
        result: { id: 9 },
      });
    });
  });
});

describe('CodeCall budgets', () => {
  it('lets the call that crosses a recordsChanged limit run, and stops the next one', async () => {
    const ada = await open(serverConfig({ budgets: RECORDS_PER_HOUR }), 'ada');
    const ids = (count: number) => JSON.stringify(Array.from({ length: count }, (_, index) => `t${index}`));

    expect(await execute(ada, `return await callTool('tickets.archive', { ids: ${ids(150)} });`)).toMatchObject({
      status: 'ok',
    });
    expect(await execute(ada, `return await callTool('tickets.archive', { ids: ${ids(80)} });`)).toMatchObject({
      status: 'ok',
    });
    const stopped = await execute(ada, `return await callTool('tickets.archive', { ids: ${ids(1)} });`);

    expect(stopped).toMatchObject({ status: 'needs_approval', reason: expect.stringContaining('records-per-hour') });
    expect(executed).toEqual(['tickets.archive:150', 'tickets.archive:80']);
  });

  it('answers denied when the budget says so, which a script may catch', async () => {
    const ada = await open(serverConfig({ budgets: threeCallsPerHour('denied') }), 'ada');
    await execute(ada, THREE_GETS);

    const uncaught = await execute(ada, "return await callTool('tickets.get', { id: 4 });");
    const caught = await execute(
      ada,
      "try {\n  await callTool('tickets.get', { id: 5 });\n} catch (error) {\n  return error.message;\n}",
    );

    expect(uncaught).toMatchObject({ status: 'denied', reason: expect.stringContaining('calls-per-hour') });
    expect(caught).toMatchObject({ status: 'ok', result: expect.stringContaining('calls-per-hour') });
    expect(executed).toEqual(['tickets.get:1', 'tickets.get:2', 'tickets.get:3']);
  });

  it('holds the counts across two server instances that share one store', async () => {
    const storage = { type: 'sqlite' as const, sqlite: { path: join(dir, 'budgets.sqlite') } };
    const budgets = { ...threeCallsPerHour(), storage };
    const first = await open(serverConfig({ budgets }), 'ada');
    const second = await open(serverConfig({ budgets }), 'ada');

    await execute(first, "await callTool('tickets.get', { id: 1 });\nawait callTool('tickets.get', { id: 2 });");
    await execute(second, "await callTool('tickets.get', { id: 3 });");

    expect(await execute(first, "return await callTool('tickets.get', { id: 4 });")).toMatchObject({
      status: 'needs_approval',
    });
    expect(executed).toEqual(['tickets.get:1', 'tickets.get:2', 'tickets.get:3']);
  });

  it('counts only what a tool reports, never what a result or its arguments say', async () => {
    const ada = await open(serverConfig({ budgets: RECORDS_PER_HOUR }), 'ada');
    const claim = "{ recordsChanged: 1000, _meta: { recordsChanged: 1000 }, onRecordsChanged: 'x' }";

    const outcome = await execute(
      ada,
      `await callTool('tickets.echo', { note: ${claim} });\n` +
        `await callTool('tickets.echo', { note: ${claim} });\n` +
        "return await callTool('tickets.archive', { ids: ['t1'] });",
    );

    expect(outcome).toMatchObject({ status: 'ok', result: { archived: 1 } });
    expect(executed).toEqual(['tickets.echo', 'tickets.echo', 'tickets.archive:1']);
  });

  it('counts codecall:invoke calls with the scripts, and stops one over the budget', async () => {
    const ada = await open(serverConfig({ directCalls: { enabled: true }, budgets: threeCallsPerHour() }), 'ada');
    await execute(ada, "await callTool('tickets.get', { id: 1 });\nawait callTool('tickets.get', { id: 2 });");
    const invoke = (id: number) => ada.callTool('codecall:invoke', { tool: 'tickets.get', input: { id } });

    expect(((await invoke(3)) as CallToolResult).isError).toBeFalsy();
    const stopped = (await invoke(4)) as CallToolResult;

    expect(stopped.isError).toBe(true);
    expect(stopped.structuredContent).toMatchObject({
      status: 'needs_approval',
      findings: [expect.objectContaining({ rule: BUDGET_EXCEEDED_RULE })],
    });
    expect(executed).toEqual(['tickets.get:1', 'tickets.get:2', 'tickets.get:3']);
  });

  it('does not count a call refused before its tool ran', async () => {
    const ada = await open(serverConfig({ budgets: threeCallsPerHour() }), 'ada');

    await execute(
      ada,
      "for (const id of ['a', 'b', 'c']) {\n  try {\n    await callTool('tickets.get', { id });\n  } catch (error) {}\n}",
    );

    expect(await execute(ada, "return await callTool('tickets.get', { id: 1 });")).toMatchObject({ status: 'ok' });
    expect(executed).toEqual(['tickets.get:1']);
  });

  it('counts a call whose tool started and then refused its input, so a tool cannot hide from a budget', async () => {
    const ada = await open(serverConfig({ budgets: threeCallsPerHour() }), 'ada');

    await execute(
      ada,
      "for (const id of [1, 2, 3]) {\n  try {\n    await callTool('tickets.reject', {});\n  } catch (error) {}\n}",
    );

    expect(await execute(ada, "return await callTool('tickets.get', { id: 1 });")).toMatchObject({
      status: 'needs_approval',
    });
    expect(executed).toEqual(['tickets.reject', 'tickets.reject', 'tickets.reject']);
  });

  it('never stops or counts keep and recall, and still counts every real tool call', async () => {
    const oneCallPerHour = { ...threeCallsPerHour(), limits: [{ ...threeCallsPerHour().limits[0], limit: 1 }] };
    const ada = await open(serverConfig({ budgets: oneCallPerHour }), 'ada');

    const outcome = await execute(
      ada,
      "await keep('seen', 4);\nconst ticket = await callTool('tickets.get', { id: await recall('seen') });\n" +
        "await keep('last', ticket.id);\nreturn await recall('last');",
    );

    expect(outcome).toMatchObject({ status: 'ok', result: 4 });
    expect(await execute(ada, "return await callTool('tickets.get', { id: 5 });")).toMatchObject({
      status: 'needs_approval',
    });
    expect(executed).toEqual(['tickets.get:4']);
  });

  it('counts the records a tool reports after its call timed out', async () => {
    const ada = await open(serverConfig({ budgets: RECORDS_PER_HOUR }), 'ada');

    const timedOut = await execute(
      ada,
      "try {\n  await callTool('tickets.purge', {});\n  return 'ran';\n} catch (error) {\n  return error.message;\n}",
    );
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(timedOut).toMatchObject({ status: 'ok', result: expect.stringMatching(/timed out|timeout/i) });
    expect(executed).toEqual(['tickets.purge']);
    expect(await execute(ada, "return await callTool('tickets.archive', { ids: ['t1'] });")).toMatchObject({
      status: 'needs_approval',
    });
  });

  it('lets one of two calls that start together through a limit of one', async () => {
    const oneCallPerHour = { ...threeCallsPerHour(), limits: [{ ...threeCallsPerHour().limits[0], limit: 1 }] };
    const ada = await open(serverConfig({ budgets: oneCallPerHour }), 'ada');

    await execute(
      ada,
      "return await parallel([1, 2], (id) => callTool('tickets.get', { id }, { throwOnError: false }));",
    );

    expect(executed).toHaveLength(1);
  });

  it('asks for changes, not an approval, for a call over a budget after a tool with effects ran in the script', async () => {
    const oneCallPerHour = { ...threeCallsPerHour(), limits: [{ ...threeCallsPerHour().limits[0], limit: 1 }] };
    const ada = await open(serverConfig({ budgets: oneCallPerHour }), 'ada');

    const outcome = await execute(
      ada,
      "await callTool('tickets.archive', { ids: ['t1'] });\nreturn await callTool('tickets.get', { id: 1 });",
    );

    expect(outcome).toMatchObject({
      status: 'needs_changes',
      findings: [expect.objectContaining({ rule: 'approval-after-effects', toolName: 'tickets.get' })],
    });
    expect(outcome).not.toHaveProperty('approval');
    expect(executed).toEqual(['tickets.archive:1']);
  });

  it('records the decision of a budget with review off, and says in the description what a budget stop means', async () => {
    const ada = await open(serverConfig({ budgets: threeCallsPerHour() }), 'ada');

    const ran = await execute(ada, THREE_GETS);
    const stopped = await execute(ada, "return await callTool('tickets.get', { id: 4 });");

    expect((await readRun(ada, ran.runId as string))?.reviewDecision).toBe('allow');
    expect((await readRun(ada, stopped.runId as string))?.reviewDecision).toBe('needs_approval');
    const description = await executeDescriptionOf(ada);
    expect(description).toContain('| timeout | needs_changes | needs_approval | denied\n');
    expect(description).toContain('approval-after-effects (needs_changes)');
    expect(description).toContain('send the stopped call in a script of its own');
    expect(description).toContain('BUDGETS: ');
    expect(description).toContain('the calls before a stopped one already ran');
    expect(description).toContain('budget-unavailable: the budget store failed; a reset does not fix it');
  });
});

describe('approving a call over a budget', () => {
  it('denies a call over a budget when nobody can approve it, as review does', async () => {
    const ada = await open(serverConfig({ budgets: threeCallsPerHour() }, { approvalPlugin: false }), 'ada');
    await execute(ada, THREE_GETS);

    const outcome = await execute(ada, "return await callTool('tickets.get', { id: 4 });");

    expect(outcome).toMatchObject({ status: 'denied', reason: expect.stringContaining('nobody can approve it here') });
    expect(outcome).not.toHaveProperty('approval');
    expect(executed).toEqual(['tickets.get:1', 'tickets.get:2', 'tickets.get:3']);
  });

  it('runs the call once for a grant, and asks again for the same script and for the next call', async () => {
    const ada = await open(serverConfig({ budgets: threeCallsPerHour() }), 'ada');
    await execute(ada, THREE_GETS);
    const fourth = "return await callTool('tickets.get', { id: 4 });";

    const asked = await execute(ada, fourth);
    expect(asked).toMatchObject({ status: 'needs_approval', approval: { toolName: 'tickets.get' } });
    expect(asked.approval).not.toHaveProperty('anyArgumentsId');
    await ada.callTool('approvals.grant', { id: asked.approval?.id as string });

    expect(await execute(ada, fourth)).toMatchObject({ status: 'ok', result: { id: 4 } });
    const again = await execute(ada, fourth);
    expect(again).toMatchObject({ status: 'needs_approval', approval: { id: asked.approval?.id } });
    const next = await execute(ada, "return await callTool('tickets.get', { id: 5 });");
    expect(next).toMatchObject({ status: 'needs_approval' });
    expect(next.approval?.id).not.toBe(asked.approval?.id);
    expect(executed).toEqual(['tickets.get:1', 'tickets.get:2', 'tickets.get:3', 'tickets.get:4']);
  });

  it('asks for a destructive-call approval and a budget approval apart, and runs the call only with both', async () => {
    const config = serverConfig({ review: {}, budgets: threeCallsPerHour() });
    const ada = await open(config, 'ada');
    await execute(ada, THREE_GETS);
    const deleteOne = "return await callTool('tickets.delete', { id: 7 });";

    const destructive = await execute(ada, deleteOne);
    expect(destructive).toMatchObject({ status: 'needs_approval', reason: expect.stringContaining('destructive') });
    await ada.callTool('approvals.grant', { id: destructive.approval?.id as string });
    const overBudget = await execute(ada, deleteOne);
    expect(overBudget).toMatchObject({
      status: 'needs_approval',
      findings: [expect.objectContaining({ rule: BUDGET_EXCEEDED_RULE })],
    });
    expect(overBudget.approval?.id).not.toBe(destructive.approval?.id);
    expect(executed).not.toContain('tickets.delete:7');
    await ada.callTool('approvals.grant', { id: overBudget.approval?.id as string });

    expect(await execute(ada, deleteOne)).toMatchObject({ status: 'ok', result: { deleted: 7 } });
    expect(executed).toContain('tickets.delete:7');
  });

  it('asks a person through elicitation in the same call, for a script and for codecall:invoke', async () => {
    const config = serverConfig(
      { directCalls: { enabled: true }, budgets: threeCallsPerHour() },
      { approvalPlugin: false, elicitation: true },
    );
    const ada = await open(config, 'ada', { onElicitation: accept });
    await execute(ada, THREE_GETS);

    expect(await execute(ada, "return await callTool('tickets.get', { id: 4 });")).toMatchObject({
      status: 'ok',
      result: { id: 4 },
    });
    const invoked = (await ada.callTool('codecall:invoke', {
      tool: 'tickets.get',
      input: { id: 5 },
    })) as CallToolResult;
    expect(invoked.isError).toBeFalsy();
    expect(executed).toEqual(['tickets.get:1', 'tickets.get:2', 'tickets.get:3', 'tickets.get:4', 'tickets.get:5']);
  });

  it('denies the call when the person declines', async () => {
    const config = serverConfig({ budgets: threeCallsPerHour() }, { approvalPlugin: false, elicitation: true });
    const ada = await open(config, 'ada', { onElicitation: async () => ({ action: 'decline' }) });
    await execute(ada, THREE_GETS);

    expect(await execute(ada, "return await callTool('tickets.get', { id: 4 });")).toMatchObject({
      status: 'denied',
      reason: expect.stringContaining('the person did not approve it'),
    });
    expect(executed).toEqual(['tickets.get:1', 'tickets.get:2', 'tickets.get:3']);
  });

  it('binds an approval to the call at its place, so a re-run never spends it on an earlier identical call', async () => {
    const twoCallsPerHour = { ...threeCallsPerHour(), limits: [{ ...threeCallsPerHour().limits[0], limit: 2 }] };
    const ada = await open(serverConfig({ budgets: twoCallsPerHour }), 'ada');
    const threeIdentical = "for (const id of [7, 7, 7]) {\n  await callTool('tickets.get', { id });\n}";

    const third = await execute(ada, threeIdentical);
    expect(third).toMatchObject({ status: 'needs_approval' });
    await ada.callTool('approvals.grant', { id: third.approval?.id as string });
    const rerun = await execute(ada, threeIdentical);

    expect(rerun).toMatchObject({ status: 'needs_approval' });
    expect(rerun.approval?.id).not.toBe(third.approval?.id);
    expect(executed).toEqual(['tickets.get:7', 'tickets.get:7']);
  });

  it('checks the budgets again after a review waited for a person, and stops a call the wait let past the limit', async () => {
    const config = serverConfig(
      {
        review: {},
        directCalls: { enabled: true },
        budgets: { ...threeCallsPerHour(), limits: [{ ...threeCallsPerHour().limits[0], limit: 1 }] },
      },
      { approvalPlugin: false, elicitation: true },
    );
    const other = await open(config, 'ada');
    const ada = await open(config, 'ada', {
      onElicitation: async () => {
        await execute(other, "return await callTool('tickets.get', { id: 1 });");
        return { action: 'accept', content: { approve: true } };
      },
    });

    const invoked = (await ada.callTool('codecall:invoke', {
      tool: 'tickets.delete',
      input: { id: 9 },
    })) as CallToolResult;

    expect(invoked.isError).toBe(true);
    expect(invoked.structuredContent).toMatchObject({
      status: 'needs_approval',
      findings: [expect.objectContaining({ rule: BUDGET_EXCEEDED_RULE })],
    });
    expect(executed).toEqual(['tickets.get:1']);
  });

  it('asks an elicitation-only client to approve each budget a codecall:invoke is over', async () => {
    const limits = [
      { name: 'calls-per-hour', counts: 'toolCalls' as const, limit: 1, windowSeconds: 3600 },
      { name: 'calls-per-day', counts: 'toolCalls' as const, limit: 1, windowSeconds: 86400 },
    ];
    const config = serverConfig(
      { directCalls: { enabled: true }, budgets: { limits, storage: { type: 'memory' } } },
      { approvalPlugin: false, elicitation: true },
    );
    const questions: string[] = [];
    const ada = await open(config, 'ada', {
      onElicitation: async (request) => {
        questions.push(request.message);
        return { action: 'accept', content: { approve: true } };
      },
    });
    await execute(ada, "await callTool('tickets.get', { id: 1 });");

    const invoked = (await ada.callTool('codecall:invoke', {
      tool: 'tickets.get',
      input: { id: 2 },
    })) as CallToolResult;

    expect(invoked.isError).toBeFalsy();
    expect(questions).toHaveLength(2);
    expect(questions[0]).toContain('calls-per-hour');
    expect(questions[1]).toContain('calls-per-day');
    expect(executed).toEqual(['tickets.get:1', 'tickets.get:2']);
  });
});
