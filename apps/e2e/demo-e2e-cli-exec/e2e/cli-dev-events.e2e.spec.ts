/**
 * `frontmcp dev` writes the dev events of its server to `.frontmcp/dev-events.jsonl`: the timing of each call, its
 * failure, and the event-loop stalls `observability.stalls` detects. Under `--stdio --serve` the server sends them
 * to the bridge over the IPC channel and the bridge writes the file.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';

import { fileExists, readFile } from '@frontmcp/utils';

import {
  createScratchProject,
  envWithoutPort,
  freePort,
  FRONTMCP_BIN,
  helloServerFiles,
  isListening,
  removeScratchProject,
  StdioBridgeClient,
  waitFor,
} from './helpers/dev-cli';
import { McpJsonRpcClient } from './helpers/mcp-client';

const TEST_TIMEOUT = 120_000;

interface DevEvent {
  type: string;
  method?: string;
  entry?: string;
  outcome?: string;
  durationMs?: number;
  error?: { code?: string };
  calls?: Array<{ entry: string }>;
}

const TOOLS = `import { Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({ name: 'fail', description: 'Always fails', inputSchema: {} })
export class FailTool extends ToolContext {
  async execute(): Promise<string> {
    throw new Error('this tool always fails');
  }
}

@Tool({ name: 'busy-wait', description: 'Blocks the event loop', inputSchema: { ms: z.number() } })
export class BusyWaitTool extends ToolContext {
  async execute(input: { ms: number }): Promise<string> {
    const end = Date.now() + input.ms;
    while (Date.now() < end) {
      // blocks on purpose
    }
    return 'done';
  }
}
`;

/** The hello server plus a failing and a busy-waiting tool, with stall detection on. */
function eventsServerFiles(): Record<string, string> {
  const files = helloServerFiles();
  return {
    ...files,
    'src/tools.ts': TOOLS,
    'src/main.ts': files['src/main.ts']
      .replace(
        "import HelloTool from './hello.tool';",
        "import HelloTool from './hello.tool';\nimport { BusyWaitTool, FailTool } from './tools';",
      )
      .replace('tools: [HelloTool]', 'tools: [HelloTool, FailTool, BusyWaitTool]')
      .replace(
        'logging: { level: LogLevel.Warn },',
        'logging: { level: LogLevel.Warn },\n  observability: { tracing: false, logging: false, stalls: { thresholdMs: 200 } },',
      ),
  };
}

async function readEvents(file: string): Promise<DevEvent[]> {
  if (!(await fileExists(file))) return [];
  return (await readFile(file))
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as DevEvent);
}

function expectCallsAndStall(events: DevEvent[]): void {
  expect(events).toContainEqual(
    expect.objectContaining({ type: 'call', method: 'tools/call', entry: 'hello:hello', outcome: 'ok' }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      type: 'call',
      entry: 'hello:fail',
      outcome: 'error',
      error: expect.objectContaining({ code: expect.any(String) }),
    }),
  );
  const stall = events.find((event) => event.type === 'stall');
  expect(stall?.calls?.map((call) => call.entry)).toContain('hello:busy-wait');
  expect(JSON.stringify(events)).not.toContain('Hello, events');
}

describe('frontmcp dev — dev events', () => {
  let projectDir: string;
  let dev: ChildProcess | undefined;
  let bridge: StdioBridgeClient | undefined;

  beforeEach(async () => {
    projectDir = await createScratchProject('dev-events', eventsServerFiles());
  });

  afterEach(async () => {
    dev?.kill('SIGTERM');
    if (dev && dev.exitCode === null) await new Promise((resolve) => dev?.once('exit', resolve));
    dev = undefined;
    await bridge?.close();
    bridge = undefined;
    await removeScratchProject(projectDir);
  });

  it(
    'writes call timings, failures and stalls to .frontmcp/dev-events.jsonl',
    async () => {
      const port = await freePort();
      let output = '';
      dev = spawn(process.execPath, [FRONTMCP_BIN, 'dev', '--port', String(port), '--entry', 'src/main.ts'], {
        cwd: projectDir,
        env: envWithoutPort(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      dev.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
      dev.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
      const eventsFile = path.join(projectDir, '.frontmcp', 'dev-events.jsonl');

      try {
        await waitFor(() => isListening(port), 60_000, `the dev server on port ${port}`);
        expect(output).toMatch(/events: \.frontmcp[\\/]dev-events\.jsonl/);

        const client = McpJsonRpcClient.forPort(port, '/');
        await client.initialize();
        await client.callTool('hello', { name: 'events' });
        await client.callTool('fail', {});
        await client.callTool('busy-wait', { ms: 500 });

        await waitFor(
          async () => (await readEvents(eventsFile)).some((event) => event.type === 'stall'),
          30_000,
          'a stall event in the dev events file',
        );
        expectCallsAndStall(await readEvents(eventsFile));
      } catch (err) {
        throw new Error(`${(err as Error).message}\noutput:\n${output}`, { cause: err });
      }
    },
    TEST_TIMEOUT,
  );

  it(
    '--stdio --serve: the bridge writes the events its server sends over the IPC channel',
    async () => {
      const eventsFile = path.join(projectDir, 'logs', 'events.jsonl');
      bridge = new StdioBridgeClient(projectDir, ['--serve', '--events-file', 'logs/events.jsonl']);

      await bridge.initialize();
      await bridge.request('tools/call', { name: 'hello', arguments: { name: 'events' } });
      await bridge.request('tools/call', { name: 'fail', arguments: {} });
      await bridge.request('tools/call', { name: 'busy-wait', arguments: { ms: 500 } });

      await waitFor(
        async () => (await readEvents(eventsFile)).some((event) => event.type === 'stall'),
        30_000,
        `a stall event in ${eventsFile}; bridge stderr:\n${bridge.stderr}`,
      );
      expectCallsAndStall(await readEvents(eventsFile));
    },
    TEST_TIMEOUT,
  );
});
