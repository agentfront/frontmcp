import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  App,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  Tool,
  ToolContext,
  type InputPolicy,
  type LogRecord,
} from '../../../common';

const inputWarnings: string[] = [];

@LogTransport({ name: 'InputPolicyCapture', description: 'Keeps warnings for assertions' })
class WarningCapture extends LogTransportInterface {
  log(record: LogRecord): void {
    if (record.level === LogLevel.Warn) inputWarnings.push(String(record.message));
  }
}

@Tool({ name: 'agent_wait', inputSchema: { timeoutSec: z.number().default(45) }, outputSchema: 'string' })
class AgentWaitTool extends ToolContext {
  async execute(input: { timeoutSec: number }) {
    return `waited ${input.timeoutSec}s`;
  }
}

@Tool({
  name: 'lenient_wait',
  inputSchema: { timeoutSec: z.number().default(45) },
  outputSchema: 'string',
  input: { undeclaredKeys: 'strip' },
})
class LenientWaitTool extends ToolContext {
  async execute(input: { timeoutSec: number }) {
    return `waited ${input.timeoutSec}s`;
  }
}

@App({ id: 'agents', name: 'Agents', tools: [AgentWaitTool, LenientWaitTool] })
class AgentsApp {}

@Tool({ name: 'strict_wait', inputSchema: { timeoutSec: z.number().default(45) }, outputSchema: 'string' })
class StrictWaitTool extends ToolContext {
  async execute(input: { timeoutSec: number }) {
    return `waited ${input.timeoutSec}s`;
  }
}

@App({ id: 'strict', name: 'Strict', tools: [StrictWaitTool], input: { undeclaredKeys: 'fail' } })
class StrictApp {}

describe('tools/call input.undeclaredKeys', () => {
  const originalNodeEnv = process.env['NODE_ENV'];

  afterEach(() => {
    process.env['NODE_ENV'] = originalNodeEnv;
    inputWarnings.length = 0;
  });

  function startServer(input?: InputPolicy): Promise<TestFetchServer> {
    return createTestFetchServer({
      info: { name: 'input-policy', version: '1.0.0' },
      apps: [AgentsApp, StrictApp],
      logging: { level: LogLevel.Warn, enableConsole: false, transports: [WarningCapture] },
      ...(input && { input }),
    });
  }

  async function callWait(server: TestFetchServer, name: string) {
    const { message } = await rpc20260728(server.handler, 'tools/call', { name, arguments: { timeoutMs: '1800000' } });
    const result = message.result ?? {};
    const texts = ((result['content'] ?? []) as Array<{ text?: string }>).map((block) => block.text);
    return { isError: result['isError'] === true, texts, wire: JSON.stringify(message) };
  }

  it('drops an undeclared argument without a word by default outside development', async () => {
    process.env['NODE_ENV'] = 'production';
    const server = await startServer();

    expect(await callWait(server, 'agent_wait')).toMatchObject({ isError: false, texts: ['waited 45s'] });
    expect(inputWarnings).toEqual([]);
  });

  it('tells the model and the log by default in development, naming the closest declared key', async () => {
    process.env['NODE_ENV'] = 'development';
    const server = await startServer();

    const first = await callWait(server, 'agent_wait');
    await callWait(server, 'agent_wait');

    expect(first.isError).toBe(false);
    expect(first.texts).toEqual([
      'waited 45s',
      "These arguments are not declared and were ignored: 'timeoutMs' (did you mean 'timeoutSec'?).",
    ]);
    const warnings = inputWarnings.filter((line) => line.includes('agent_wait'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('timeoutMs');
  });

  it("refuses the call under a server-level 'fail', naming the key and the closest declared one", async () => {
    const server = await startServer({ undeclaredKeys: 'fail' });

    const refused = await callWait(server, 'agent_wait');

    expect(refused.wire).toContain('INVALID_INPUT');
    expect(refused.wire).toContain("Unknown arguments: 'timeoutMs' (did you mean 'timeoutSec'?)");
    expect(refused.wire).not.toContain('waited');
  });

  it("lets a tool's policy override the server's", async () => {
    const server = await startServer({ undeclaredKeys: 'fail' });

    expect(await callWait(server, 'lenient_wait')).toMatchObject({ isError: false, texts: ['waited 45s'] });
  });

  it("lets an app's policy override the server's", async () => {
    const server = await startServer({ undeclaredKeys: 'strip' });

    expect((await callWait(server, 'strict_wait')).wire).toContain('INVALID_INPUT');
  });

  it('refuses an unknown policy at boot', async () => {
    await expect(startServer({ undeclaredKeys: 'drop' } as unknown as InputPolicy)).rejects.toThrow(/undeclaredKeys/);
  });
});
