/**
 * Two hosts in one process on one container (#1356): an HTTP server started with `FrontMcpInstance.bootstrap()` and a
 * direct server, both with `{ container }`. Each calls `bump`, which counts in one `Tally` the container built; the
 * container's duty runs once a server serves. Then both shut down, and the container is disposed.
 */
import 'reflect-metadata';

import {
  App,
  createContainer,
  Duty,
  FrontMcpInstance,
  LogLevel,
  Provider,
  Tool,
  ToolContext,
  type OnShutdown,
} from '@frontmcp/sdk';

import { report, requiredEnv, runWorker } from './worker-protocol';

export interface ContainerHostsResult {
  built: number;
  viaHttp: { count: number; pid: number };
  viaDirect: { count: number; pid: number };
  dutyRan: boolean;
  shutdownsBeforeDispose: number;
  shutdowns: number;
}

let built = 0;
let shutdowns = 0;
let dutyRuns = 0;

@Provider({ name: 'tally' })
class Tally implements OnShutdown {
  count = 0;
  constructor() {
    built++;
  }
  onShutdown() {
    shutdowns++;
  }
}

@Tool({ name: 'bump', inputSchema: {} })
class BumpTool extends ToolContext {
  async execute() {
    return { count: ++this.get(Tally).count, pid: process.pid };
  }
}

@Duty({ name: 'beat', every: 200, scope: 'machine', leaseMs: 3_000 })
class BeatDuty {
  run(): void {
    dutyRuns++;
  }
}

@App({ name: 'Tally', tools: [BumpTool], providers: [BeatDuty] })
class TallyApp {}

/** One JSON-RPC message to the HTTP server, and its answer, plain or the last event of a stream. */
async function post(port: number, body: unknown, session?: string): Promise<{ session?: string; answer?: unknown }> {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(session ? { 'mcp-session-id': session } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const data = text.includes('data:')
    ? text
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trim())
        .pop()
    : text;
  return { session: response.headers.get('mcp-session-id') ?? session, answer: data ? JSON.parse(data) : undefined };
}

async function bumpOverHttp(port: number): Promise<{ count: number; pid: number }> {
  const clientInfo = { name: 'container-hosts', version: '1.0.0' };
  const { session } = await post(port, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo },
  });
  await post(port, { jsonrpc: '2.0', method: 'notifications/initialized' }, session);
  const { answer } = await post(
    port,
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bump', arguments: {} } },
    session,
  );
  return (answer as { result: { structuredContent: { count: number; pid: number } } }).result.structuredContent;
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

runWorker(async () => {
  const info = { name: 'container-hosts', version: '1.0.0' };
  const logging = { level: LogLevel.Off, enableConsole: false };
  const container = await createContainer({ providers: [Tally], apps: [TallyApp], logging, info });
  const port = Number(requiredEnv('PORT'));

  const http = await FrontMcpInstance.bootstrap({
    info,
    apps: [TallyApp],
    http: { port, entryPath: '/mcp' },
    auth: { mode: 'public' },
    logging,
    container,
  });
  const direct = await FrontMcpInstance.createDirect({ info, apps: [TallyApp], logging, container });

  const viaHttp = await bumpOverHttp(port);
  const viaDirect = (await direct.callTool('bump', {})).structuredContent as { count: number; pid: number };
  await until(() => dutyRuns > 0, 'the duty to run');

  await http?.shutdown();
  await direct.dispose();
  const shutdownsBeforeDispose = shutdowns;
  await container.dispose();
  report({
    built,
    viaHttp,
    viaDirect,
    dutyRan: dutyRuns > 0,
    shutdownsBeforeDispose,
    shutdowns,
  } satisfies ContainerHostsResult);
  process.exit(0);
});
