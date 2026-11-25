/**
 * Each call a script makes gets an idempotency key from its run and its position in the run, which the tool reads as
 * `this.idempotencyKey`; a client's own call of the same tool has none.
 */
import 'reflect-metadata';

import { App, connect, LogLevel, Tool, ToolContext, z, type CallToolResult, type DirectClient } from '@frontmcp/sdk';

import CodeCallPlugin from '../codecall.plugin';
import type { CodeCallVmRuntime } from '../codecall.types';
import { callIdempotencyKey } from '../runs/call-idempotency-key';

jest.setTimeout(30000);

const keysSeen: Array<string | undefined> = [];

@Tool({
  name: 'payments.charge',
  description: 'Charges a card for the idempotency key spec',
  inputSchema: { cents: z.number() },
  codecall: { visibleInListTools: true },
})
class ChargeTool extends ToolContext {
  async execute({ cents }: { cents: number }) {
    keysSeen.push(this.idempotencyKey);
    return { charged: cents };
  }
}

function serverConfig(runtime: CodeCallVmRuntime) {
  @App({
    id: 'billing',
    name: 'Billing',
    tools: [ChargeTool],
    plugins: [
      CodeCallPlugin.init({
        mode: 'codecall_only',
        vm: { preset: 'secure', runtime },
        directCalls: { enabled: true },
        runs: { storage: { type: 'memory' } },
      }),
    ],
  })
  class BillingApp {}

  return {
    info: { name: 'codecall-idempotency-key', version: '1.0.0' },
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

describe('callIdempotencyKey', () => {
  it('is the same for the same run and position, and another at another position or run', () => {
    const runId = '3f0c6f7e-5d1b-4f43-9a4d-2a7c1b6e8f10';

    expect(callIdempotencyKey(runId, 2)).toBe(callIdempotencyKey(runId, 2));
    expect(callIdempotencyKey(runId, 2)).not.toBe(callIdempotencyKey(runId, 3));
    expect(callIdempotencyKey(runId, 2)).not.toBe(callIdempotencyKey('7b1e2c90-0d4f-4c6a-8e3b-5f9a2d1c4e70', 2));
  });
});

describe.each<CodeCallVmRuntime>(['node-vm', 'interpreter'])('this.idempotencyKey on the %s runtime', (runtime) => {
  let client: DirectClient;

  beforeAll(async () => {
    client = await connect(serverConfig(runtime), { session: { id: `idempotency-${runtime}` } });
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(() => {
    keysSeen.length = 0;
  });

  it('gives each call of a script the key of its run and position, even with the same arguments', async () => {
    const script =
      "await callTool('payments.charge', { cents: 100 });\n" +
      "await callTool('payments.charge', { cents: 100 });\n" +
      'return await payments.charge({ cents: 250 });';
    const executed = structuredOf<{ status: string; runId?: string }>(
      (await client.callTool('codecall:execute', { script })) as CallToolResult,
    );

    expect(executed.status).toBe('ok');
    const runId = executed.runId as string;
    expect(keysSeen).toEqual([0, 1, 2].map((position) => callIdempotencyKey(runId, position)));
    expect(new Set(keysSeen).size).toBe(3);
  });

  it('gives another run of the same script other keys', async () => {
    const script = "return await callTool('payments.charge', { cents: 100 });";
    await client.callTool('codecall:execute', { script });
    await client.callTool('codecall:execute', { script });

    expect(keysSeen).toHaveLength(2);
    expect(keysSeen[0]).not.toBe(keysSeen[1]);
  });

  it('gives a client call of the tool, direct or through codecall:invoke, no key', async () => {
    await client.callTool('payments.charge', { cents: 100, idempotencyKey: 'forged' });
    await client.callTool('codecall:invoke', { tool: 'payments.charge', input: { cents: 100 } });

    expect(keysSeen).toEqual([undefined, undefined]);
  });
});
