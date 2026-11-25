/**
 * keep and recall through a real server, on both runtimes: a value one script keeps, a later script of the same
 * session and caller recalls; another owner, or the same one after the TTL, recalls nothing; a large string reaches a
 * tool of the later script without entering its sandbox.
 */
import 'reflect-metadata';

import { App, connect, LogLevel, Tool, ToolContext, z, type CallToolResult, type DirectClient } from '@frontmcp/sdk';

import CodeCallPlugin from '../codecall.plugin';
import type { CodeCallPluginOptionsInput, CodeCallVmRuntime } from '../codecall.types';
import { CodeCallRunStoreToken, type CodeCallRunRecord } from '../runs/run-record.types';

// The first script a test worker runs includes the sandbox's cold start.
jest.setTimeout(30000);

const FIVE_MB = 5 * 1024 * 1024;

@Tool({ name: 'invoices.overdue', description: 'Lists overdue invoices for the keep spec', inputSchema: {} })
class OverdueInvoicesTool extends ToolContext {
  async execute() {
    return {
      invoices: [
        { id: 'inv-1', amount: 120 },
        { id: 'inv-2', amount: 80 },
      ],
    };
  }
}

@Tool({
  name: 'docs.read',
  description: 'Reads a large document for the keep spec',
  inputSchema: { bytes: z.number().int() },
  outputSchema: 'string',
})
class ReadDocumentTool extends ToolContext {
  async execute({ bytes }: { bytes: number }) {
    return 'd'.repeat(bytes);
  }
}

@Tool({
  name: 'docs.measure',
  description: 'Measures a document for the keep spec',
  inputSchema: { text: z.string() },
})
class MeasureDocumentTool extends ToolContext {
  async execute({ text }: { text: string }) {
    return { length: text.length, allD: /^d+$/.test(text) };
  }
}

@Tool({
  name: 'runs.read',
  description: "Reads a run record as the caller's owner",
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
  result?: unknown;
  kept?: string[];
  runId?: string;
  error?: { message: string; toolName?: string };
}

function serverConfig(options: CodeCallPluginOptionsInput) {
  @App({
    id: 'billing',
    name: 'Billing',
    tools: [OverdueInvoicesTool, ReadDocumentTool, MeasureDocumentTool, ReadRunTool],
    plugins: [CodeCallPlugin.init({ mode: 'codecall_only', ...options })],
  })
  class BillingApp {}

  return {
    info: { name: 'codecall-keep-recall', version: '1.0.0' },
    apps: [BillingApp],
    logging: { level: LogLevel.Off },
  };
}

function structuredOf<T>(result: CallToolResult): T {
  if (result.structuredContent) return result.structuredContent as T;
  const [first] = result.content;
  if (first?.type !== 'text') throw new Error('the tool returned no text content');
  return JSON.parse(first.text) as T;
}

async function execute(client: DirectClient, script: string): Promise<ExecuteOutcome> {
  return structuredOf<ExecuteOutcome>((await client.callTool('codecall:execute', { script })) as CallToolResult);
}

const RUNTIMES: CodeCallVmRuntime[] = ['node-vm', 'interpreter'];
const clients: DirectClient[] = [];

async function open(config: ReturnType<typeof serverConfig>, id: string, subject = 'alice') {
  const client = await connect(config, { session: { id, user: { sub: subject } } });
  clients.push(client);
  return client;
}

afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

const KEEP_OVERDUE =
  "const overdue = await callTool('invoices.overdue', {});\nawait keep('overdue', overdue.invoices);\nreturn overdue.invoices.length;";

describe.each(RUNTIMES)('keep and recall on the %s runtime', (runtime) => {
  const config = serverConfig({ vm: { preset: 'secure', runtime }, keep: { storage: { type: 'memory' } } });

  it('recalls in a later script what an earlier one kept, and lists the names kept, never the values', async () => {
    const client = await open(config, `keep-${runtime}`);

    const first = await execute(client, KEEP_OVERDUE);
    expect(first).toMatchObject({ status: 'ok', result: 2, kept: ['overdue'] });
    expect(JSON.stringify(first)).not.toContain('inv-1');

    const second = await execute(client, "const overdue = await recall('overdue');\nreturn overdue.map((i) => i.id);");
    expect(second).toMatchObject({ status: 'ok', result: ['inv-1', 'inv-2'] });
    expect(second).not.toHaveProperty('kept');
  });

  it('recalls nothing in another session or for another caller', async () => {
    const owner = await open(config, `owner-${runtime}`);
    await execute(owner, KEEP_OVERDUE);

    const otherSession = await open(config, `other-${runtime}`);
    const otherCaller = await open(config, `owner-${runtime}`, 'mallory');
    const script = "return (await recall('overdue')) === undefined;";
    expect(await execute(otherSession, script)).toMatchObject({ status: 'ok', result: true });
    expect(await execute(otherCaller, script)).toMatchObject({ status: 'ok', result: true });
  });

  it('recalls nothing after the TTL', async () => {
    const client = await open(config, `ttl-${runtime}`);
    await execute(client, KEEP_OVERDUE);
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 601_000);

    expect(await execute(client, "return (await recall('overdue')) === undefined;")).toMatchObject({
      status: 'ok',
      result: true,
    });
  });

  it('journals each keep and recall in the run record with its kind and name', async () => {
    const client = await open(config, `journal-${runtime}`);
    const { runId } = await execute(client, "await keep('totals', { sum: 200 });\nreturn await recall('totals');");

    const read = structuredOf<{ record: CodeCallRunRecord }>(
      (await client.callTool('runs.read', { runId: runId ?? '' })) as CallToolResult,
    );
    expect(
      read.record.journal.map(({ position, tool, kind, name, outcome }) => ({ position, tool, kind, name, outcome })),
    ).toEqual([
      { position: 1, tool: 'codecall:keep', kind: 'keep', name: 'totals', outcome: 'success' },
      { position: 2, tool: 'codecall:recall', kind: 'recall', name: 'totals', outcome: 'success' },
    ]);
  });

  it('leaves a script its own variable named keep', async () => {
    const client = await open(config, `own-keep-${runtime}`);

    expect(await execute(client, 'const keep = [3, 1, 2].filter((n) => n > 1);\nreturn keep;')).toMatchObject({
      status: 'ok',
      result: [3, 2],
    });
  });

  it('lets the review run keep and recall, which reach no tool', async () => {
    const reviewed = serverConfig({
      vm: { preset: 'secure', runtime },
      keep: { storage: { type: 'memory' } },
      review: {},
    });
    const client = await open(reviewed, `review-${runtime}`);

    expect(await execute(client, KEEP_OVERDUE)).toMatchObject({ status: 'ok', kept: ['overdue'] });
    expect(await execute(client, "return (await recall('overdue')).length;")).toMatchObject({
      status: 'ok',
      result: 2,
    });
  });

  it('has neither function with keep.enabled false', async () => {
    const client = await open(
      serverConfig({ vm: { preset: 'secure', runtime }, keep: { enabled: false } }),
      `off-${runtime}`,
    );

    const outcome = await execute(client, "await keep('a', 1);\nreturn 1;");
    expect(outcome.status).toBe('illegal_access');
    expect(outcome.error?.message).toContain('Unknown identifier "keep"');
  });

  describe('with the sidecar', () => {
    const sidecarConfig = serverConfig({
      vm: {
        preset: 'secure',
        runtime,
        timeoutMs: 20000,
        ...(runtime === 'interpreter' && { memoryLimitBytes: 1024 * 1024 }),
      },
      sidecar: { enabled: true, extractionThreshold: 64 * 1024 },
      keep: { storage: { type: 'memory' }, maxBytes: 8 * 1024 * 1024 },
      runs: { resume: true },
    });

    it('passes a 5 MB string kept in one script to a tool in the next, outside the sandbox', async () => {
      const client = await open(sidecarConfig, `sidecar-${runtime}`);

      const first = await execute(
        client,
        `const doc = await callTool('docs.read', { bytes: ${FIVE_MB} });\nawait keep('doc', doc);\nreturn doc.length;`,
      );
      expect(first).toMatchObject({ status: 'ok', kept: ['doc'] });
      expect(first.result).toBeLessThan(100);

      const second = await execute(
        client,
        "const doc = await recall('doc');\nconst measured = await callTool('docs.measure', { text: doc });\nreturn { held: doc.length, measured };",
      );
      expect(second).toMatchObject({ status: 'ok', result: { measured: { length: FIVE_MB, allD: true } } });
      expect((second.result as { held: number }).held).toBeLessThan(100);

      const read = structuredOf<{ record: CodeCallRunRecord }>(
        (await client.callTool('runs.read', { runId: second.runId ?? '' })) as CallToolResult,
      );
      expect(read.record.journal[0]).toMatchObject({ kind: 'recall', outcome: 'success' });
      expect(read.record.journal[0].resultBytes).toBeLessThan(100);
    });
  });
});

describe('the sandbox memory limit, without the sidecar', () => {
  it('stops a script that loads a large string itself', async () => {
    const config = serverConfig({ vm: { preset: 'secure', runtime: 'interpreter', memoryLimitBytes: 1024 * 1024 } });
    const client = await open(config, 'no-sidecar');

    const outcome = await execute(
      client,
      `const doc = await callTool('docs.read', { bytes: ${2 * 1024 * 1024} });\nreturn doc.length;`,
    );
    expect(outcome).toMatchObject({
      status: 'runtime_error',
      error: { message: expect.stringContaining('Memory limit exceeded') },
    });
  });
});
