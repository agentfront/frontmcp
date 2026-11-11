/**
 * Claude Code spawns a channel server over stdio, probes it with `server/discover` on 2026-07-28, and never
 * declares `experimental['claude/channel']`. The server declines the probe, so Claude Code sends `initialize`,
 * and the stdio session then gets the channel events.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { MCP_20260728_META, PROTOCOL_2026_07_28, type JSONRPCMessage, type Transport } from '@frontmcp/protocol';

import { App, Channel, ChannelContext, LogLevel, Tool, ToolContext, type ChannelNotification } from '../../common';
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

/** Pushes the `alert` events of the app into the session. */
@Channel({ name: 'alerts', source: { type: 'app-event', event: 'alert' } })
class AlertsChannel extends ChannelContext {
  /** Sends the event's text. */
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    return { content: String((payload as { text: string }).text) };
  }
}

/** Emits an `alert` event, as application code does. */
@Tool({ name: 'raise', inputSchema: { text: z.string() } })
class RaiseTool extends ToolContext {
  /** Emits the event on the scope's event bus. */
  async execute(input: { text: string }) {
    this.scope.channelEventBus?.emit('alert', { text: input.text });
    return { raised: true };
  }
}

/** The app Claude Code spawns: one channel, and the tool that feeds it. */
@App({ id: 'desk', name: 'Desk', tools: [RaiseTool], channels: [AlertsChannel] })
class DeskApp {}

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

describe('runStdio with channels', () => {
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

  it('declines the 2026-07-28 probe, then sends channel events to the session that declared no capability', async () => {
    await FrontMcpInstance.runStdio({
      info: { name: 'stdio-channels', version: '1.0.0' },
      apps: [DeskApp],
      channels: { enabled: true },
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
      error: {
        code: -32022,
        data: { supported: ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'], requested: '2026-07-28' },
      },
    });

    fromClient({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: CLAUDE_CODE_CAPABILITIES, clientInfo: CLAUDE_CODE_INFO },
    });
    expect(await reply(0)).toMatchObject({
      result: { protocolVersion: '2025-11-25', capabilities: { experimental: { 'claude/channel': {} } } },
    });

    fromClient({ jsonrpc: '2.0', method: 'notifications/initialized' });
    fromClient({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'raise', arguments: { text: 'disk full' } },
    });

    expect(
      await written((message) => 'method' in message && message.method === 'notifications/claude/channel'),
    ).toEqual({
      jsonrpc: '2.0',
      method: 'notifications/claude/channel',
      params: { content: 'disk full', meta: { source: 'alerts' } },
    });
    expect(await reply(1)).toMatchObject({ result: { structuredContent: { raised: true } } });
  });
});
