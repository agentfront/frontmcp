/**
 * The dev events of a real server (`createFetchHandler()`) started the way `frontmcp dev` starts it: with
 * `FRONTMCP_DEV_EVENTS_FILE` set.
 */
import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';

import { App, FrontMcpInstance, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '@frontmcp/sdk';
import { fileExists, mkdtemp, readFile, rm } from '@frontmcp/utils';

import ObservabilityPlugin from '../plugin/observability.plugin';
import type { RequestLog } from '../request-log/request-log.types';

// The SDK loads the package the server imports, as one install does, not a separate build of it.
jest.mock('@frontmcp/observability', () => jest.requireActual('../index'), { virtual: true });

@Tool({ name: 'ping', inputSchema: {} })
class Ping extends ToolContext {
  async execute() {
    return 'pong';
  }
}

@App({ id: 'desk', name: 'Desk', tools: [Ping] })
class DeskApp {}

const pingCall = new Request('https://desk.example.com/', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'mcp-protocol-version': '2026-07-28',
    'mcp-method': 'tools/call',
    'mcp-name': 'ping',
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'ping', arguments: {}, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } },
  }),
});

async function writtenCallEvents(file: string): Promise<unknown[]> {
  if (!(await fileExists(file))) return [];
  return (await readFile(file))
    .split('\n')
    .slice(0, -1)
    .map((line) => JSON.parse(line) as { type: string })
    .filter((event) => event.type === 'call');
}

/** The call events once the first is written, then 50 ms more, so a duplicate written behind it is counted. */
async function callEventsIn(file: string): Promise<unknown[]> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline && (await writtenCallEvents(file)).length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  return writtenCallEvents(file);
}

describe('a server frontmcp dev starts', () => {
  const env = { ...process.env };
  let dir: string;
  let eventsFile: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dev-events-server-'));
    eventsFile = path.join(dir, 'dev-events.jsonl');
    process.env['FRONTMCP_DEV_EVENTS_FILE'] = eventsFile;
  });

  afterEach(async () => {
    process.env = { ...env };
    await rm(dir, { recursive: true, force: true });
  });

  const serve = (config: Partial<FrontMcpConfigInput>) =>
    FrontMcpInstance.createFetchHandler({
      info: { name: 'desk', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
      ...config,
    } as FrontMcpConfigInput);

  it('writes call events with no observability config, loading the plugin for the events alone', async () => {
    const handler = await serve({});

    await handler(pingCall.clone());

    expect(await callEventsIn(eventsFile)).toEqual([
      expect.objectContaining({ type: 'call', method: 'tools/call', entry: 'desk:ping', outcome: 'ok' }),
    ]);
  });

  it('keeps an ObservabilityPlugin the server installs itself, and writes each call event once', async () => {
    const logs: RequestLog[] = [];
    const handler = await serve({
      plugins: [
        ObservabilityPlugin.init({ tracing: false, requestLogs: { onRequestComplete: (log) => void logs.push(log) } }),
      ],
    });

    await handler(pingCall.clone());

    expect(await callEventsIn(eventsFile)).toEqual([
      expect.objectContaining({ type: 'call', method: 'tools/call', entry: 'desk:ping', outcome: 'ok' }),
    ]);
    expect(logs).toHaveLength(1);
  });

  it('writes each call event once when an app installs ObservabilityPlugin', async () => {
    @App({ id: 'desk', name: 'Desk', tools: [Ping], plugins: [ObservabilityPlugin.init({ tracing: false })] })
    class ObservedDeskApp {}

    const handler = await serve({ apps: [ObservedDeskApp] });

    await handler(pingCall.clone());

    expect(await callEventsIn(eventsFile)).toHaveLength(1);
  });
});
