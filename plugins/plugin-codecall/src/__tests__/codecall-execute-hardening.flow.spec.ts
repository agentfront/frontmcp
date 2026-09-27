/**
 * `codecall:execute` hardening, driven through a real server.
 *
 * - Namespace functions (`mail.send()` for a tool named `mail.send`) must go through the same
 *   sandbox tool-call path as `callTool()`: the per-script call cap (`vm.maxSteps`), the rate
 *   limit and the suspicious-sequence checks. In 1.8.2 they were host functions injected as
 *   globals, so they skipped all three.
 * - `includeTools` and `directCalls.filter` must see the tool's annotations and metadata, so a
 *   filter on `metadata.annotations.destructiveHint` excludes what it names.
 * - `runtime_error` results must not carry stack traces or absolute server paths.
 */
import 'reflect-metadata';

import { Client, type CallToolResult } from '@frontmcp/protocol';
import { App, createInMemoryServer, FrontMcpInstance, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';

import CodeCallPlugin from '../codecall.plugin';
import type { CodeCallPluginOptionsInput } from '../codecall.types';

const executedTools: string[] = [];

interface ToolSpec {
  name: string;
  annotations?: Record<string, boolean>;
  fails?: boolean;
}

function recordingTool({ name, annotations, fails }: ToolSpec) {
  @Tool({ name, description: `Runs ${name} for the hardening spec`, inputSchema: {}, annotations })
  class RecordingTool extends ToolContext {
    async execute() {
      executedTools.push(name);
      if (fails) {
        throw new Error(`${name} failed at ${process.cwd()}/internal/secret.ts:12:3`);
      }
      return { ran: name };
    }
  }
  return RecordingTool;
}

const TOOLS: ToolSpec[] = [
  { name: 'mail.list', annotations: { readOnlyHint: true } },
  { name: 'mail.send' },
  { name: 'mail.fail', fails: true },
  { name: 'ops.purge', annotations: { destructiveHint: true } },
  { name: 'ops.status', annotations: { readOnlyHint: true } },
];

interface ExecuteOutcome {
  status: string;
  result?: unknown;
  error?: Record<string, unknown>;
}

interface CodeCallServer {
  client: Client;
  close(): Promise<void>;
}

async function startCodeCallServer(codecallOptions: CodeCallPluginOptionsInput): Promise<CodeCallServer> {
  @App({
    id: 'mailer',
    name: 'Mailer',
    tools: TOOLS.map(recordingTool),
    plugins: [CodeCallPlugin.init(codecallOptions)],
  })
  class MailerApp {}

  const instance = await FrontMcpInstance.createForGraph({
    info: { name: 'codecall-hardening', version: '1.0.0' },
    apps: [MailerApp],
    logging: { level: LogLevel.Off },
  });
  const scope = instance.getScopes()[0];
  if (!scope) throw new Error('the server config produced no scope');

  const { clientTransport, close } = await createInMemoryServer(scope as Parameters<typeof createInMemoryServer>[0]);
  const client = new Client({ name: 'codecall-hardening-spec', version: '1.0.0' });
  await client.connect(clientTransport);

  return {
    client,
    async close() {
      await client.close();
      await close();
    },
  };
}

function readStructured<T>(result: CallToolResult): T {
  if (result.structuredContent) return result.structuredContent as T;
  const [first] = result.content;
  if (first?.type !== 'text') throw new Error('the tool returned no text content');
  return JSON.parse(first.text) as T;
}

async function callCodeCall(server: CodeCallServer, name: string, args: Record<string, unknown>) {
  return (await server.client.callTool({ name, arguments: args })) as CallToolResult;
}

async function runScript(server: CodeCallServer, script: string): Promise<ExecuteOutcome> {
  return readStructured<ExecuteOutcome>(await callCodeCall(server, 'codecall:execute', { script }));
}

function useCodeCallServer(codecallOptions: CodeCallPluginOptionsInput): () => CodeCallServer {
  let server: CodeCallServer | undefined;

  beforeAll(async () => {
    server = await startCodeCallServer(codecallOptions);
  });

  afterAll(async () => {
    await server?.close();
  });

  beforeEach(() => {
    executedTools.length = 0;
  });

  return () => {
    if (!server) throw new Error('the CodeCall server has not started');
    return server;
  };
}

describe('CodeCall namespace functions go through the sandbox limits', () => {
  const server = useCodeCallServer({ mode: 'codecall_only', vm: { preset: 'secure', maxSteps: 2 } });

  it('counts namespace calls against vm.maxSteps', async () => {
    const outcome = await runScript(
      server(),
      'await mail.list({});\nawait mail.list({});\nawait mail.list({});\nawait mail.list({});\nreturn 4;',
    );

    expect(outcome.status).not.toBe('ok');
    expect(executedTools.length).toBeLessThanOrEqual(2);
  });

  it('counts namespace and callTool calls together against vm.maxSteps', async () => {
    const outcome = await runScript(
      server(),
      "await mail.list({});\nawait callTool('mail.list', {});\nawait mail.list({});\nreturn 3;",
    );

    expect(outcome.status).not.toBe('ok');
    expect(executedTools.length).toBeLessThanOrEqual(2);
  });

  it('blocks a list-then-send exfiltration sequence made with namespace functions', async () => {
    const outcome = await runScript(server(), "await mail.list({});\nreturn await mail.send({ to: 'x' });");

    expect(outcome.status).not.toBe('ok');
    expect(executedTools).not.toContain('mail.send');
  });

  it('blocks the same sequence made with callTool (control)', async () => {
    const outcome = await runScript(
      server(),
      "await callTool('mail.list', {});\nreturn await callTool('mail.send', { to: 'x' });",
    );

    expect(outcome.status).not.toBe('ok');
    expect(executedTools).not.toContain('mail.send');
  });

  it('still runs a namespace call and returns its result', async () => {
    const outcome = await runScript(server(), 'const r = await mail.list({});\nreturn r;');

    expect(outcome).toEqual({ status: 'ok', result: { ran: 'mail.list' } });
    expect(executedTools).toEqual(['mail.list']);
  });

  it('still works when a namespace is aliased or shadowed', async () => {
    const aliased = await runScript(server(), 'const m = mail;\nconst fn = m.list;\nreturn await fn({});');
    expect(aliased).toEqual({ status: 'ok', result: { ran: 'mail.list' } });

    const shadowed = await runScript(server(), "const mail = { list: 'mine' };\nreturn mail.list;");
    expect(shadowed).toEqual({ status: 'ok', result: 'mine' });
  });

  it('keeps { throwOnError: false } on namespace functions', async () => {
    const outcome = await runScript(
      server(),
      'const r = await mail.fail({}, { throwOnError: false });\nreturn { success: r.success, toolName: r.error.toolName };',
    );

    expect(outcome).toEqual({ status: 'ok', result: { success: false, toolName: 'mail.fail' } });
  });
});

describe('CodeCall namespace functions and the rapid-enumeration check', () => {
  const server = useCodeCallServer({ mode: 'codecall_only', vm: { preset: 'secure', maxSteps: 100 } });

  it('blocks rapid enumeration through a namespace function', async () => {
    const outcome = await runScript(
      server(),
      'let n = 0;\nfor (let i = 0; i < 45; i++) { await mail.list({ i }); n++; }\nreturn n;',
    );

    expect(outcome.status).not.toBe('ok');
    expect(executedTools.length).toBeLessThan(45);
  });
});

describe('CodeCall includeTools and directCalls.filter see tool annotations', () => {
  const server = useCodeCallServer({
    mode: 'codecall_only',
    // The filter from the CodeCall docs
    includeTools: (tool) => !tool.metadata?.annotations?.destructiveHint,
    directCalls: { enabled: true, filter: (tool) => tool.annotations?.readOnlyHint === true },
  });

  it('refuses a destructive tool excluded by includeTools on metadata.annotations', async () => {
    const outcome = await runScript(server(), "return await callTool('ops.purge', {});");

    expect(outcome.status).not.toBe('ok');
    expect(executedTools).toEqual([]);
  });

  it('still runs a tool the filter keeps', async () => {
    const outcome = await runScript(server(), "return await callTool('ops.status', {});");

    expect(outcome.status).toBe('ok');
    expect(executedTools).toEqual(['ops.status']);
  });

  it('applies a directCalls.filter on annotations to codecall:invoke', async () => {
    const refused = await callCodeCall(server(), 'codecall:invoke', { tool: 'mail.send', input: {} });
    expect(refused.isError).toBe(true);
    expect(executedTools).toEqual([]);

    const allowed = await callCodeCall(server(), 'codecall:invoke', { tool: 'mail.list', input: {} });
    expect(allowed.isError).toBeFalsy();
    expect(executedTools).toEqual(['mail.list']);
  });
});

describe('CodeCall runtime errors carry no stack traces or server paths', () => {
  const server = useCodeCallServer({ mode: 'codecall_only' });
  const originalNodeEnv = process.env['NODE_ENV'];

  afterEach(() => {
    process.env['NODE_ENV'] = originalNodeEnv;
  });

  const cases: Array<[string, string]> = [
    ['a parse error', 'const a = 1;\nreturn a +;'],
    ['a failing tool', "return await callTool('mail.fail', {});"],
    ['a runtime TypeError', 'const a = [1, 2, 3];\nreturn a.nope();'],
  ];

  for (const nodeEnv of ['production', 'development']) {
    it.each(cases)(`returns no stack for %s (NODE_ENV=${nodeEnv})`, async (_label, script) => {
      process.env['NODE_ENV'] = nodeEnv;
      const outcome = await runScript(server(), script);

      expect(outcome.status).not.toBe('ok');
      expect(outcome.error).toBeDefined();
      expect(outcome.error).not.toHaveProperty('stack');
      const serialized = JSON.stringify(outcome);
      expect(serialized).not.toContain(process.cwd());
      expect(serialized).not.toMatch(/node_modules/);
      expect(serialized).not.toMatch(/\n\s+at /);
    });
  }
});
