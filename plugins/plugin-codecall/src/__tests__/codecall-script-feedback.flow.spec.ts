/**
 * What `codecall:execute` tells a model about a script it refused or a value over a limit, the same on both
 * runtimes (#1329, #1330). Up to 1.12.2 a script with `new Set()` was refused as `"__safe_Set"`, the interpreter
 * runtime named no issue at all, and a tool result over `vm.maxSanitizeProperties` ended the script with
 * "Tool handler return value exceeds maximum properties (2000)." naming neither the tool nor the count.
 */
import 'reflect-metadata';

import { type CallToolResult } from '@frontmcp/protocol';
import { Client } from '@frontmcp/protocol/client';
import { App, createInMemoryServer, FrontMcpInstance, LogLevel, Tool, ToolContext, z } from '@frontmcp/sdk';

import CodeCallPlugin from '../codecall.plugin';

jest.setTimeout(30000);

const executed: string[] = [];

@Tool({
  name: 'items.list',
  description: 'Lists items for the feedback spec',
  inputSchema: { count: z.number() },
})
class ListItemsTool extends ToolContext {
  async execute(input: { count: number }) {
    executed.push('items.list');
    return { items: Array.from({ length: input.count }, (_, index) => ({ id: index, name: 'n' })) };
  }
}

interface ExecuteOutcome {
  status: string;
  result?: unknown;
  error?: Record<string, unknown>;
}

async function startServer(runtime: 'node-vm' | 'interpreter') {
  @App({
    id: 'feedback-app',
    name: 'Feedback App',
    tools: [ListItemsTool],
    plugins: [CodeCallPlugin.init({ mode: 'codecall_only', vm: { preset: 'secure', runtime } })],
  })
  class FeedbackApp {}

  const instance = await FrontMcpInstance.createForGraph({
    info: { name: 'codecall-feedback', version: '1.0.0' },
    apps: [FeedbackApp],
    logging: { level: LogLevel.Off },
  });
  const scope = instance.getScopes()[0];
  if (!scope) throw new Error('the server config produced no scope');
  const { clientTransport, close } = await createInMemoryServer(scope as Parameters<typeof createInMemoryServer>[0]);
  const client = new Client({ name: 'codecall-feedback-spec', version: '1.0.0' });
  await client.connect(clientTransport);

  return {
    async run(script: string): Promise<ExecuteOutcome> {
      const result = (await client.callTool({ name: 'codecall:execute', arguments: { script } })) as CallToolResult;
      if (result.structuredContent) return result.structuredContent as unknown as ExecuteOutcome;
      const [first] = result.content;
      if (first?.type !== 'text') throw new Error('the tool returned no text content');
      return JSON.parse(first.text) as ExecuteOutcome;
    },
    async stop() {
      await client.close();
      await close();
    },
  };
}

describe.each(['node-vm', 'interpreter'] as const)('codecall:execute feedback on the %s runtime', (runtime) => {
  let server: Awaited<ReturnType<typeof startServer>>;

  beforeAll(async () => {
    server = await startServer(runtime);
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    executed.length = 0;
  });

  it('names a global AgentScript lacks as the script wrote it, at its line, with what to use instead', async () => {
    const outcome = await server.run('const ids = [];\nconst seen = new WeakSet();\nreturn ids.length;');

    expect(outcome.status).toBe('illegal_access');
    expect(outcome.error?.['message']).toBe(
      'AgentScript validation failed:\n' +
        'DISALLOWED_IDENTIFIER (line 2): WeakSet is not available in AgentScript; use a Set',
    );
    expect(executed).toEqual([]);
  });

  it.each([
    [
      'Promise',
      'const all = await Promise.all([]);\nreturn all;',
      'use parallel(items, (item) => callTool(name, args))',
    ],
    ['Symbol', "const key = Symbol('id');\nreturn 1;", 'use a string'],
    ['WeakMap', 'const cache = new WeakMap();\nreturn 1;', 'use a Map'],
    ['structuredClone', 'return structuredClone({ a: 1 });', 'use JSON.parse(JSON.stringify(value))'],
  ])('refuses %s with its alternative', async (name, script, alternative) => {
    const outcome = await server.run(script);

    expect(outcome.status).toBe('illegal_access');
    expect(outcome.error?.['message']).toContain(`${name} is not available in AgentScript; ${alternative}`);
  });

  it('runs a script with Set, Map, and an Error it throws and catches', async () => {
    const outcome = await server.run(
      "const seen = new Set(['a', 'b', 'a']);\nconst totals = new Map([['k', 1]]);\n" +
        "let caught = '';\ntry { throw new Error('x'); } catch (error) { caught = error.message; }\n" +
        "return { size: seen.size, has: seen.has('a'), k: totals.get('k'), keys: [...totals.keys()], caught };",
    );

    expect(outcome).toMatchObject({
      status: 'ok',
      result: { size: 2, has: true, k: 1, keys: ['k'], caught: 'x' },
    });
  });

  it('reports an Error the script throws as runtime_error with its message', async () => {
    const outcome = await server.run("throw new Error('no overdue invoices');");

    expect(outcome).toMatchObject({
      status: 'runtime_error',
      error: { source: 'script', name: 'Error', message: 'no overdue invoices' },
    });
  });

  it('returns a Set as its values, a Map as its [key, value] pairs, and an Error as its name and message', async () => {
    const outcome = await server.run(
      "return { set: new Set(['a', 'b']), map: new Map([['k', 1]]), error: new Error('oops') };",
    );

    expect(outcome).toMatchObject({
      status: 'ok',
      result: { set: ['a', 'b'], map: [['k', 1]], error: { name: 'Error', message: 'oops' } },
    });
  });

  it.each([
    [
      'Set',
      'const all = new Set();\nfor (const index of Array(2500).fill(0).map((_, i) => i)) { all.add(index); }\nreturn all;',
    ],
    [
      'Map',
      'const all = new Map();\nfor (const index of Array(2500).fill(0).map((_, i) => i)) { all.set(String(index), index); }\nreturn all;',
    ],
  ])("counts a returned %s's entries against vm.maxSanitizeProperties", async (_kind, script) => {
    const outcome = await server.run(script);

    expect(outcome.status).toBe('runtime_error');
    expect(outcome.error?.['message']).toMatch(/^The script's return value holds more than 2,000 values/);
  });

  it('names an undeclared identifier as written and lists only the globals a script can use', async () => {
    const outcome = await server.run('const total = 1;\nreturn totl + 1;');

    expect(outcome.status).toBe('illegal_access');
    const message = String(outcome.error?.['message']);
    expect(message).toContain('UNKNOWN_GLOBAL (line 2): Unknown identifier "totl". Declare it with const or let');
    expect(message).toContain('Globals a script can use: Array,');
    expect(message).toContain('callTool');
    expect(message).toContain('parseInt');
    expect(message).not.toContain('__');
  });

  it('reports a tool result over vm.maxSanitizeProperties as that tool error, with its count', async () => {
    const outcome = await server.run(
      "const page = await callTool('items.list', { count: 700 });\nreturn page.items.length;",
    );

    expect(outcome.status).toBe('tool_error');
    expect(outcome.error).toMatchObject({ source: 'tool', toolName: 'items.list', code: 'RESULT_TOO_LARGE' });
    expect(outcome.error?.['message']).toMatch(
      /^The result of "items\.list" holds 2,\d{3} values \(array items and object keys, at every depth\); vm\.maxSanitizeProperties allows 2,000\./,
    );
  });

  it('returns a tool result under the limit', async () => {
    const outcome = await server.run(
      "const page = await callTool('items.list', { count: 600 });\nreturn page.items.length;",
    );

    expect(outcome).toMatchObject({ status: 'ok', result: 600 });
  });

  it('lets a script handle a result over the limit with throwOnError: false', async () => {
    const outcome = await server.run(
      "const page = await callTool('items.list', { count: 700 }, { throwOnError: false });\n" +
        'return page.success ? 0 : page.error.code;',
    );

    expect(outcome).toMatchObject({ status: 'ok', result: 'RESULT_TOO_LARGE' });
  });

  it("says when the script's own return value is over the limit", async () => {
    const outcome = await server.run(
      'const rows = [];\n' +
        "for (const index of Array(700).fill(0).map((_, i) => i)) { rows.push({ id: index, name: 'n' }); }\n" +
        'return rows;',
    );

    expect(outcome.status).toBe('runtime_error');
    expect(outcome.error?.['message']).toBe(
      "The script's return value holds more than 2,000 values (array items and object keys, at every depth), " +
        'the vm.maxSanitizeProperties limit. Return fewer items or fields, or a summary.',
    );
  });
});
