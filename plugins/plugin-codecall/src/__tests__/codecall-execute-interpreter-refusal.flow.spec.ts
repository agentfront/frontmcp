/**
 * `codecall:execute` with `vm.runtime: 'interpreter'` against an Enclave worker entry that does not
 * export the validated AgentScript runner, driven through a real server.
 *
 * CodeCall refuses the run before any of the script executes, says why, and does not fall back to
 * the Node VM or to the bare `InterpreterAdapter`.
 */
import 'reflect-metadata';

import { type CallToolResult } from '@frontmcp/protocol';
import { Client } from '@frontmcp/protocol/client';
import { App, createInMemoryServer, FrontMcpInstance, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';

import CodeCallPlugin from '../codecall.plugin';

jest.mock('@enclave-vm/core/worker', () => ({}));

const executed: string[] = [];

@Tool({ name: 'users.list', description: 'Lists users for the refusal spec', inputSchema: {} })
class ListUsersTool extends ToolContext {
  async execute() {
    executed.push('users.list');
    return { users: [] };
  }
}

describe("codecall:execute with vm.runtime 'interpreter' and no validated runner", () => {
  let client: Client;
  let closeServer: () => Promise<void>;

  beforeAll(async () => {
    @App({
      id: 'refusal-app',
      name: 'Refusal App',
      tools: [ListUsersTool],
      plugins: [CodeCallPlugin.init({ mode: 'codecall_only', vm: { preset: 'secure', runtime: 'interpreter' } })],
    })
    class RefusalApp {}

    const instance = await FrontMcpInstance.createForGraph({
      info: { name: 'codecall-interpreter-refusal', version: '1.0.0' },
      apps: [RefusalApp],
      logging: { level: LogLevel.Off },
    });
    const scope = instance.getScopes()[0];
    if (!scope) throw new Error('the server config produced no scope');
    const { clientTransport, close } = await createInMemoryServer(scope as Parameters<typeof createInMemoryServer>[0]);
    client = new Client({ name: 'codecall-refusal-spec', version: '1.0.0' });
    await client.connect(clientTransport);
    closeServer = close;
  });

  afterAll(async () => {
    await client.close();
    await closeServer();
  });

  async function run(script: string): Promise<{ status: string; error?: Record<string, unknown> }> {
    const result = (await client.callTool({ name: 'codecall:execute', arguments: { script } })) as CallToolResult;
    if (result.structuredContent) return result.structuredContent as never;
    const [first] = result.content;
    if (first?.type !== 'text') throw new Error('the tool returned no text content');
    return JSON.parse(first.text);
  }

  it('refuses the run, names the missing runner, and runs nothing', async () => {
    const outcome = await run("return await callTool('users.list', {});");

    expect(outcome).toEqual({
      status: 'runtime_error',
      error: {
        source: 'script',
        name: 'CodeCallRuntimeError',
        message: expect.stringContaining(
          "CodeCall vm.runtime 'interpreter' needs Enclave's validated AgentScript runner (AgentScriptRunner from @enclave-vm/core/worker)",
        ),
      },
    });
    expect(executed).toEqual([]);
  });

  it('still refuses a script the policy blocks as illegal access, before the runtime', async () => {
    const outcome = await run("console.log('x');\nreturn 1;");
    expect(outcome.status).toBe('illegal_access');
  });
});
