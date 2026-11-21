/**
 * `codecall:execute` on the runtime seam, driven through a real server on the default runtime:
 * the CodeCall controls a script meets (tool calls, synchronous `getTool`, denials, namespaces,
 * logging, `throwOnError`, console, validation, budgets, timeout) after the execution service
 * stopped importing the Enclave barrel statically and started closing the host side of each run.
 */
import 'reflect-metadata';

import { type CallToolResult } from '@frontmcp/protocol';
import { Client } from '@frontmcp/protocol/client';
import { App, createInMemoryServer, FrontMcpInstance, LogLevel, Tool, ToolContext, z } from '@frontmcp/sdk';

import CodeCallPlugin from '../codecall.plugin';
import type { CodeCallPluginOptions } from '../codecall.types';

const executed: string[] = [];

@Tool({ name: 'users.get', description: 'Gets a user for the runtime spec', inputSchema: { id: z.number() } })
class GetUserTool extends ToolContext {
  async execute(input: { id: number }) {
    executed.push('users.get');
    return { id: input.id, name: `user-${input.id}` };
  }
}

@Tool({ name: 'users.fail', description: 'Fails for the runtime spec', inputSchema: {} })
class FailingTool extends ToolContext {
  async execute(): Promise<never> {
    executed.push('users.fail');
    throw new Error('internal');
  }
}

@Tool({ name: 'users.slow', description: 'Answers late for the runtime spec', inputSchema: {} })
class SlowTool extends ToolContext {
  async execute() {
    executed.push('users.slow');
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return { slow: true };
  }
}

interface ExecuteOutcome {
  status: string;
  result?: unknown;
  logs?: string[];
  error?: Record<string, unknown>;
}

async function startServer(options: Partial<CodeCallPluginOptions>) {
  @App({
    id: 'runtime-app',
    name: 'Runtime App',
    tools: [GetUserTool, FailingTool, SlowTool],
    plugins: [CodeCallPlugin.init({ mode: 'codecall_only', ...options })],
  })
  class RuntimeApp {}

  const instance = await FrontMcpInstance.createForGraph({
    info: { name: 'codecall-runtime', version: '1.0.0' },
    apps: [RuntimeApp],
    logging: { level: LogLevel.Off },
  });
  const scope = instance.getScopes()[0];
  if (!scope) throw new Error('the server config produced no scope');
  const { clientTransport, close } = await createInMemoryServer(scope as Parameters<typeof createInMemoryServer>[0]);
  const client = new Client({ name: 'codecall-runtime-spec', version: '1.0.0' });
  await client.connect(clientTransport);

  return {
    async run(script: string, extra: Record<string, unknown> = {}): Promise<ExecuteOutcome> {
      const result = (await client.callTool({
        name: 'codecall:execute',
        arguments: { script, ...extra },
      })) as CallToolResult;
      if (result.structuredContent) return result.structuredContent as unknown as ExecuteOutcome;
      const [first] = result.content;
      if (first?.type !== 'text') throw new Error('the tool returned no text content');
      return JSON.parse(first.text) as ExecuteOutcome;
    },
    async close() {
      await client.close();
      await close();
    },
  };
}

describe('codecall:execute on the default runtime', () => {
  let server: Awaited<ReturnType<typeof startServer>>;

  beforeAll(async () => {
    server = await startServer({ vm: { preset: 'secure', timeoutMs: 300, maxSteps: 3 } });
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    executed.length = 0;
  });

  it('runs a tool call and returns its result', async () => {
    const outcome = await server.run("return await callTool('users.get', { id: 7 });");
    expect(outcome).toMatchObject({ status: 'ok', result: { id: 7, name: 'user-7' } });
    expect(executed).toEqual(['users.get']);
  });

  it('answers getTool synchronously, without a tool call', async () => {
    const outcome = await server.run(
      "const t = getTool('users.get');\nreturn { name: t.name, hasSchema: !!t.inputSchema };",
    );
    expect(outcome).toMatchObject({ status: 'ok', result: { name: 'users.get', hasSchema: true } });
    expect(executed).toEqual([]);
  });

  it('denies a tool outside the caller-supplied allowedTools, and getTool hides it', async () => {
    const outcome = await server.run(
      "const r = await callTool('users.fail', {}, { throwOnError: false });\nreturn { r, t: getTool('users.fail') ?? null };",
      { allowedTools: ['users.get'] },
    );
    expect(outcome.status).toBe('ok');
    expect(outcome.result).toMatchObject({ r: { success: false, error: { code: 'ACCESS_DENIED' } }, t: null });
    expect(executed).toEqual([]);
  });

  it('refuses a CodeCall meta-tool by name', async () => {
    const outcome = await server.run("return await callTool('codecall:execute', { script: 'return 1;' });");
    expect(outcome.status).not.toBe('ok');
    expect(executed).toEqual([]);
  });

  it('calls a tool through its namespace', async () => {
    const outcome = await server.run('return await users.get({ id: 2 });');
    expect(outcome).toMatchObject({ status: 'ok', result: { id: 2 } });
  });

  it('records mcpLog calls in the logs', async () => {
    const outcome = await server.run("mcpLog('info', 'step one');\nreturn 1;");
    expect(outcome).toMatchObject({ status: 'ok', logs: ['[mcp:info] step one'] });
  });

  it('returns a failing tool as data with { throwOnError: false }, and as a tool error without it', async () => {
    const asData = await server.run(
      "const r = await callTool('users.fail', {}, { throwOnError: false });\nreturn r.success;",
    );
    expect(asData).toMatchObject({ status: 'ok', result: false });

    const thrown = await server.run("return await callTool('users.fail', {});");
    expect(thrown).toMatchObject({ status: 'tool_error', error: { toolName: 'users.fail' } });
  });

  it('refuses console without vm.allowConsole before the script runs', async () => {
    const outcome = await server.run("console.log('x');\nreturn await callTool('users.get', { id: 1 });");
    expect(outcome.status).toBe('illegal_access');
    expect(executed).toEqual([]);
  });

  it('refuses a construct the validator blocks, naming the line', async () => {
    const outcome = await server.run("const a = 1;\nconst f = eval('1');\nreturn f;");
    expect(outcome.status).toBe('illegal_access');
    expect(String(outcome.error?.['message'])).toMatch(/line 2/);
  });

  it('holds the tool-call budget from vm.maxSteps', async () => {
    const outcome = await server.run(
      "for (const id of [1, 2, 3, 4]) { await callTool('users.get', { id }); }\nreturn 'all';",
    );
    expect(outcome.status).toBe('runtime_error');
    expect(executed).toEqual(['users.get', 'users.get', 'users.get']);
  });

  it('times out, says a tool call was still running, and lets the script reach nothing afterwards', async () => {
    const outcome = await server.run(
      "await callTool('users.slow', {});\nreturn await callTool('users.get', { id: 9 });",
    );
    expect(outcome.status).toBe('timeout');
    expect(String(outcome.error?.['message'])).toMatch(/timed out after 300ms \(1 tool call was still running/);

    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(executed).toEqual(['users.slow']);
  });
});

describe('codecall:execute with console allowed', () => {
  let server: Awaited<ReturnType<typeof startServer>>;

  beforeAll(async () => {
    server = await startServer({ vm: { preset: 'secure', allowConsole: true } });
  });

  afterAll(async () => {
    await server.close();
  });

  it('runs a script that writes to the console', async () => {
    await expect(server.run("console.log('hello');\nreturn 1;")).resolves.toMatchObject({ status: 'ok', result: 1 });
  });
});
