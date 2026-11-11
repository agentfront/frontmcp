/**
 * An event with the `channel` option reaches a Claude Code session over stdio with no `@Channel` and no `channels`
 * in the server's config: the server declines the 2026-07-28 probe, advertises `claude/channel`, says how events
 * arrive in its instructions, and sends each published occurrence to the session that declared no capability.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { MCP_20260728_META, PROTOCOL_2026_07_28, type JSONRPCMessage, type Transport } from '@frontmcp/protocol';

import { App, event, LogLevel, Tool, ToolContext } from '../../common';
import { FrontMcpInstance } from '../front-mcp';

const mockWritten: JSONRPCMessage[] = [];
const mockStdio: Array<{ onmessage?: Transport['onmessage'] }> = [];

jest.mock('@frontmcp/protocol', () => {
  const actual = jest.requireActual('@frontmcp/protocol');
  /** Stands in for the process's stdin and stdout. */
  class RecordingStdioServerTransport {
    onmessage?: Transport['onmessage'];
    /** Lets the spec reach the transport `runStdio()` creates. */
    constructor() {
      mockStdio.push(this);
    }
    /** Nothing to start: the spec delivers the client's messages itself. */
    async start() {
      return undefined;
    }
    /** Records what the server writes to stdout. */
    async send(message: JSONRPCMessage) {
      mockWritten.push(message);
    }
    /** Nothing to close. */
    async close() {
      return undefined;
    }
  }
  return { ...actual, StdioServerTransport: RecordingStdioServerTransport };
});

const CLAUDE_CODE_CAPABILITIES = { roots: { listChanged: true }, elicitation: { form: {}, url: {} } };
const CLAUDE_CODE_INFO = { name: 'claude-code', version: '2.1.322' };

const deployFinished = event({
  name: 'deploy.finished',
  payloadSchema: { version: z.string(), status: z.string() },
  channel: true,
});

/** Publishes the event, as application code does. */
@Tool({ name: 'finish_deploy', inputSchema: { version: z.string() } })
class FinishDeployTool extends ToolContext {
  /** Publishes one occurrence and answers its id. */
  async execute(input: { version: string }) {
    const { eventId } = await this.events.publish(deployFinished, { version: input.version, status: 'succeeded' });
    return { eventId };
  }
}

/** The app Claude Code spawns: one event with `channel`, and the tool that publishes it. */
@App({ id: 'deploys', name: 'Deploys', tools: [FinishDeployTool], events: [deployFinished] })
class DeploysApp {}

/** Delivers a message as if the client wrote it to stdin. */
function fromClient(message: JSONRPCMessage): void {
  mockStdio[0]?.onmessage?.(message);
}

/** Waits for a message the server wrote to stdout. */
async function written(match: (message: JSONRPCMessage) => boolean): Promise<JSONRPCMessage> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const found = mockWritten.find(match);
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`no matching message in ${JSON.stringify(mockWritten)}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Waits for the reply to request `id`. */
function reply(id: string | number): Promise<JSONRPCMessage> {
  return written((message) => 'id' in message && message.id === id);
}

describe('runStdio with an event that has the channel option', () => {
  const savedConsole = { ...console };
  const savedStdioEnv = process.env['FRONTMCP_STDIO'];
  const savedLogsMax = process.env['FRONTMCP_LOGS_MAX'];
  const savedSignalListeners = {
    SIGINT: process.listeners('SIGINT'),
    SIGTERM: process.listeners('SIGTERM'),
  };

  beforeAll(() => {
    process.env['FRONTMCP_LOGS_MAX'] = '0';
  });

  afterAll(() => {
    Object.assign(console, savedConsole);
    if (savedStdioEnv === undefined) delete process.env['FRONTMCP_STDIO'];
    else process.env['FRONTMCP_STDIO'] = savedStdioEnv;
    if (savedLogsMax === undefined) delete process.env['FRONTMCP_LOGS_MAX'];
    else process.env['FRONTMCP_LOGS_MAX'] = savedLogsMax;
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      for (const listener of process.listeners(signal)) {
        if (!savedSignalListeners[signal].includes(listener)) process.removeListener(signal, listener);
      }
    }
  });

  it('declines the 2026-07-28 probe, advertises claude/channel, and sends a published occurrence to the session', async () => {
    await FrontMcpInstance.runStdio({
      info: { name: 'stdio-event-channel', version: '1.0.0' },
      apps: [DeploysApp],
      logging: { level: LogLevel.Off, enableConsole: false },
    });

    fromClient({
      jsonrpc: '2.0',
      id: 'server-discover-probe-1',
      method: 'server/discover',
      params: {
        _meta: {
          [MCP_20260728_META.protocolVersion]: PROTOCOL_2026_07_28,
          [MCP_20260728_META.clientInfo]: CLAUDE_CODE_INFO,
          [MCP_20260728_META.clientCapabilities]: CLAUDE_CODE_CAPABILITIES,
        },
      },
    });
    expect(await reply('server-discover-probe-1')).toMatchObject({
      error: { code: -32022, data: { requested: '2026-07-28' } },
    });

    fromClient({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: CLAUDE_CODE_CAPABILITIES, clientInfo: CLAUDE_CODE_INFO },
    });
    expect(await reply(0)).toMatchObject({
      result: {
        protocolVersion: '2025-11-25',
        capabilities: { experimental: { 'claude/channel': {} } },
        instructions: expect.stringContaining(
          'Events arrive as <channel> tags. A tag with event and event_id attributes is an event this server published',
        ),
      },
    });

    fromClient({ jsonrpc: '2.0', method: 'notifications/initialized' });
    fromClient({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'finish_deploy', arguments: { version: '1.4.0' } },
    });

    const called = (await reply(1)) as { result: { structuredContent: { eventId: string } } };
    const { eventId } = called.result.structuredContent;
    expect(
      await written((message) => 'method' in message && message.method === 'notifications/claude/channel'),
    ).toEqual({
      jsonrpc: '2.0',
      method: 'notifications/claude/channel',
      params: {
        content: '{"version":"1.4.0","status":"succeeded"}',
        meta: { event: 'deploy.finished', event_id: eventId },
      },
    });
  });
});
