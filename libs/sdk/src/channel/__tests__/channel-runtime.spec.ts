import 'reflect-metadata';

import { MCP_20260728_META, PROTOCOL_2026_07_28 } from '@frontmcp/protocol';

import {
  createTestFetchServer,
  TEST_CLIENT_INFO,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Channel, ChannelContext, LogLevel, Provider, type ChannelNotification } from '../../common';
import { type DirectMcpServer } from '../../direct/direct.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import type { Scope } from '../../scope/scope.instance';

@Provider({ name: 'Formatter' })
class Formatter {
  format(text: string): string {
    return `[desk] ${text}`;
  }
}

@Channel({ name: 'alerts', source: { type: 'app-event', event: 'alert' } })
class AlertsChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    return { content: this.get(Formatter).format(String((payload as { text: string }).text)) };
  }
}

@Channel({
  name: 'browser_only',
  source: { type: 'app-event', event: 'browser' },
  availableWhen: { runtime: ['browser'] },
})
class BrowserOnlyChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    return { content: String(payload) };
  }
}

@App({ id: 'desk', name: 'Desk', providers: [Formatter], channels: [AlertsChannel, BrowserOnlyChannel] })
class DeskApp {}

const config = {
  info: { name: 'channel-runtime', version: '1.0.0' },
  apps: [DeskApp],
  logging: { level: LogLevel.Off },
  channels: { enabled: true },
};

function scopeOf(server: DirectMcpServer): Scope {
  return (server as unknown as { scope: Scope }).scope;
}

describe('channels at run time', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect(config);
  });

  afterAll(async () => {
    await server.dispose();
  });

  it("gives a channel declared on an app that app's providers", async () => {
    const notification = await scopeOf(server).channels?.findByName('alerts')?.handleEvent({ text: 'disk full' });

    expect(notification).toEqual({ content: '[desk] disk full' });
  });

  it('leaves out a channel whose availableWhen this runtime does not meet', () => {
    const names = scopeOf(server)
      .channels?.getChannels()
      .map((channel) => channel.name);

    expect(names).toEqual(['alerts']);
  });
});

describe('channels for MCP 2026-07-28 clients', () => {
  let fetchServer: TestFetchServer;

  beforeAll(async () => {
    fetchServer = await createTestFetchServer(config);
  });

  function listen(clientCapabilities: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
    return fetchServer.handler(
      new Request('http://localhost/', {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': PROTOCOL_2026_07_28,
          'mcp-method': 'subscriptions/listen',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'listen-1',
          method: 'subscriptions/listen',
          params: {
            notifications: {},
            _meta: {
              [MCP_20260728_META.protocolVersion]: PROTOCOL_2026_07_28,
              [MCP_20260728_META.clientInfo]: TEST_CLIENT_INFO,
              [MCP_20260728_META.clientCapabilities]: clientCapabilities,
            },
          },
        }),
      }),
    );
  }

  async function nextMessage(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Record<string, unknown>> {
    const decoder = new TextDecoder();
    let text = '';
    while (!text.includes('\n\n')) {
      const { value, done } = await reader.read();
      if (done) throw new Error('the stream ended');
      text += decoder.decode(value);
    }
    const data = text
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())
      .join('');
    return JSON.parse(data) as Record<string, unknown>;
  }

  it('carries the channel notifications on a subscriptions/listen stream with the claude/channel capability', async () => {
    const controller = new AbortController();
    const response = await listen({ experimental: { 'claude/channel': {} } }, controller.signal);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();

    const acknowledgement = await nextMessage(reader);
    const alerts = (fetchServer.instance.getScopes()[0] as Scope).channels?.findByName('alerts');
    await alerts?.handleEvent({ text: 'disk full' });
    const notification = await nextMessage(reader);
    // The stream ends once its pending read settles, so one more event lets the cancellation through.
    const cancelled = reader.cancel();
    await alerts?.handleEvent({ text: 'closing' });
    await cancelled;
    controller.abort();

    expect(acknowledgement['method']).toBe('notifications/subscriptions/acknowledged');
    expect(notification).toEqual(
      expect.objectContaining({
        method: 'notifications/claude/channel',
        params: expect.objectContaining({ content: '[desk] disk full', meta: { source: 'alerts' } }),
      }),
    );
  });
});
