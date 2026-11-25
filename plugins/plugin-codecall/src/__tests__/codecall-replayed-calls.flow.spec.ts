/**
 * Enclave's `replayedCalls` (2.21.1) through a real server, on both runtimes: runs that the detector guard would not
 * have let pause (one that took more than 5 s, one with more than 30 calls to one tool, one with more than 100 calls,
 * one whose list and paused send are more than 5 s apart) pause, and resume with their recorded calls and the paused
 * call's time passed to Enclave, without their handlers running again.
 */
import 'reflect-metadata';

import { Enclave, ENCLAVE_RUN_FEATURES } from '@enclave-vm/core';
import { AgentScriptRunner } from '@enclave-vm/core/worker';

import { App, connect, LogLevel, Tool, ToolContext, z, type CallToolResult, type DirectClient } from '@frontmcp/sdk';

import CodeCallPlugin from '../codecall.plugin';
import type { CodeCallVmRuntime } from '../codecall.types';

jest.setTimeout(60000);

const calls: string[] = [];

function called(tool: string): number {
  return calls.filter((name) => name === tool).length;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readingTool(name: string, delayMs: number) {
  @Tool({ name, description: `Reads stock for the replayed-calls spec (${name})`, inputSchema: { n: z.number() } })
  class ReadingTool extends ToolContext {
    async execute({ n }: { n: number }) {
      calls.push(name);
      await sleep(delayMs);
      return { n };
    }
  }
  return ReadingTool;
}

@Tool({ name: 'stock.send', description: 'Sends a stock report', inputSchema: { units: z.number().int().positive() } })
class SendTool extends ToolContext {
  async execute({ units }: { units: number }) {
    calls.push('stock.send');
    return { reserved: units };
  }
}

@Tool({
  name: 'stock.reserve',
  description: 'Reserves stock for the replayed-calls spec',
  inputSchema: { units: z.number().int().positive() },
})
class ReserveTool extends ToolContext {
  async execute({ units }: { units: number }) {
    calls.push('stock.reserve');
    return { reserved: units };
  }
}

const tools = [
  readingTool('stock.list', 0),
  readingTool('stock.wait', 5_200),
  readingTool('stock.count', 200),
  ...['stock.a', 'stock.b', 'stock.c', 'stock.d'].map((name) => readingTool(name, 12)),
  ReserveTool,
  SendTool,
];

function serverConfig(runtime: CodeCallVmRuntime) {
  @App({
    id: 'stock',
    name: 'Stock',
    tools,
    plugins: [
      CodeCallPlugin.init({
        mode: 'codecall_only',
        vm: { preset: 'secure', runtime, timeoutMs: 20_000 },
        runs: { storage: { type: 'memory' } },
      }),
    ],
  })
  class StockApp {}

  return {
    info: { name: 'codecall-replayed-calls', version: '1.0.0' },
    apps: [StockApp],
    logging: { level: LogLevel.Off },
  };
}

interface Answer {
  status: string;
  runId?: string;
  result?: unknown;
  paused?: { call: { position: number; tool: string } };
}

async function call(client: DirectClient, tool: string, args: Record<string, unknown>): Promise<Answer> {
  const result = (await client.callTool(tool, args)) as CallToolResult;
  return (result.structuredContent ?? JSON.parse((result.content[0] as { text: string }).text)) as Answer;
}

const RESERVE = "return await callTool('stock.reserve', { units: -1 });";

/** The numbers from 0, as an array literal: the sandbox's Array.from takes no function. */
function range(length: number): string {
  return JSON.stringify(Array.from({ length }, (_, index) => index));
}

describe('replayed calls are supported', () => {
  it("by the installed Enclave, on both runtimes, with the paused call's time and the refused call", () => {
    for (const features of [ENCLAVE_RUN_FEATURES, AgentScriptRunner.capabilities]) {
      expect(features).toEqual(expect.arrayContaining(['replayed-calls', 'replayed-calls-resume', 'refused-call']));
    }
  });
});

describe.each<CodeCallVmRuntime>(['node-vm', 'interpreter'])('replayed calls on the %s runtime', (runtime) => {
  let client: DirectClient;
  let runOptions: jest.SpyInstance;

  beforeAll(async () => {
    client = await connect(serverConfig(runtime), { session: { id: `replayed-${runtime}`, user: { sub: 'ada' } } });
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(() => {
    calls.length = 0;
    const prototype = runtime === 'node-vm' ? Enclave.prototype : AgentScriptRunner.prototype;
    runOptions = jest.spyOn(prototype, 'run');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function pauseAndResume(script: string, recordedCalls: number, pausedTool = 'stock.reserve') {
    const paused = await call(client, 'codecall:execute', { script });
    expect(paused).toMatchObject({ status: 'tool_error', paused: { call: { position: recordedCalls + 1 } } });
    const before = [...calls];

    const resumed = await call(client, 'codecall:resume', { runId: paused.runId, arguments: { units: 2 } });

    expect(resumed).toMatchObject({ status: 'ok', result: { reserved: 2 } });
    expect(calls).toEqual([...before, pausedTool]);
    const options = runOptions.mock.calls.at(-1)?.[2] as {
      replayedCalls?: unknown[];
      replayedCallsResumeAtMs?: number;
    };
    expect(options.replayedCalls).toHaveLength(recordedCalls);
    expect(options.replayedCallsResumeAtMs).toEqual(expect.any(Number));
    return options;
  }

  it('pauses a run that reached its paused call after more than 5 s, and resumes it', async () => {
    await pauseAndResume(`await callTool('stock.wait', { n: 1 });\n${RESERVE}`, 1);
    expect(called('stock.wait')).toBe(1);
  });

  it('resumes a run whose list and paused send were more than 5 s apart, clear of the read-then-send detector', async () => {
    const script =
      "await callTool('stock.list', { n: 1 });\nawait callTool('stock.wait', { n: 1 });\n" +
      "return await callTool('stock.send', { units: -1 });";
    const options = await pauseAndResume(script, 2, 'stock.send');
    expect(options.replayedCallsResumeAtMs).toBeGreaterThanOrEqual(5_200);
  });

  it('pauses a run with more than 30 calls to one tool, and resumes it', async () => {
    const script = `for (const n of ${range(34)}) {\n  await callTool('stock.count', { n });\n}\n${RESERVE}`;
    await pauseAndResume(script, 34);
    expect(called('stock.count')).toBe(34);
  });

  it('pauses a run with more than 100 calls, and resumes it', async () => {
    const perTool = ['stock.a', 'stock.b', 'stock.c', 'stock.d'].map((tool) => `  await callTool('${tool}', { n });`);
    const script = `for (const n of ${range(26)}) {\n${perTool.join('\n')}\n}\n${RESERVE}`;
    await pauseAndResume(script, 104);
    expect(calls.filter((name) => name !== 'stock.reserve')).toHaveLength(104);
  });
});
