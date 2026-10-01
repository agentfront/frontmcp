/**
 * Channels as the docs describe them (#678):
 * - every notification a channel pushes runs the hookable `channels:send-notification` flow, which
 *   adds `channels.defaultMeta` to it (not only to `ChannelNotificationService.send()`);
 * - a session that initializes with the `claude/channel` capability subscribes to the channels the
 *   hookable `channels:list` flow returns;
 * - an `onReply()` that throws makes `channel-reply` answer an error instead of "sent successfully";
 * - disposing the server (`dispose()` on what `create()` returns) calls `onDisconnect()`.
 */
import 'reflect-metadata';

import { type ScopeEntry } from '../../common';
import { type DirectClient } from '../../direct/client.types';
import { type DirectMcpServer } from '../../direct/direct.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import {
  App,
  Channel,
  ChannelContext,
  ChannelListHook,
  ChannelSendHook,
  LogLevel,
  Plugin,
  Tool,
  ToolContext,
  z,
  type ChannelNotification,
  type FlowCtxOf,
} from '../../index';
import { type ChannelInstance } from '../channel.instance';

const lifecycle: string[] = [];
const sends: Array<{ channel: string; content: string }> = [];

@Channel({ name: 'chat', source: { type: 'service', service: 'chat' }, twoWay: true, meta: { room: 'ops' } })
class ChatChannel extends ChannelContext {
  override async onConnect(): Promise<void> {
    lifecycle.push('connect');
  }

  override async onDisconnect(): Promise<void> {
    lifecycle.push('disconnect');
  }

  async onEvent(payload: unknown): Promise<ChannelNotification> {
    return { content: String((payload as { text: string }).text), meta: { kind: 'chat' } };
  }

  override async onReply(reply: string): Promise<void> {
    if (reply === 'boom') throw new Error('chat service refused the reply');
    lifecycle.push(`reply:${reply}`);
  }
}

@Channel({ name: 'alerts', source: { type: 'app-event', event: 'alert' }, replay: { enabled: true, maxEvents: 2 } })
class AlertsChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    return { content: String((payload as { text: string }).text) };
  }
}

@Channel({ name: 'muted', source: { type: 'app-event', event: 'muted' } })
class MutedChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    return { content: String((payload as { text: string }).text) };
  }
}

@Tool({ name: 'raise', inputSchema: { event: z.string(), text: z.string() } })
class RaiseTool extends ToolContext {
  async execute(input: { event: string; text: string }) {
    // `channelEventBus` is declared on ScopeEntry: no cast needed.
    this.scope.channelEventBus?.emit(input.event, { text: input.text });
    return { raised: true };
  }
}

@Plugin({ name: 'channel-policy' })
class ChannelPolicyPlugin {
  @ChannelSendHook.Will('send')
  beforeSend(ctx: FlowCtxOf<'channels:send-notification'>) {
    const { channelName, content } = ctx.state.required;
    sends.push({ channel: channelName, content });
    if (content.includes('classified')) ctx.respond({ sent: false, channelName });
  }

  @ChannelListHook.Did('listChannels')
  hideMuted(ctx: FlowCtxOf<'channels:list'>) {
    const output = ctx.state.output;
    if (!output) return;
    const channels = output.channels.filter((channel) => channel.name !== 'muted');
    ctx.state.set({ output: { channels, count: channels.length } });
  }
}

@App({
  id: 'desk',
  name: 'Desk',
  plugins: [ChannelPolicyPlugin],
  tools: [RaiseTool],
  channels: [ChatChannel, AlertsChannel, MutedChannel],
})
class DeskApp {}

function scopeOf(server: DirectMcpServer): ScopeEntry {
  return (server as unknown as { scope: ScopeEntry }).scope;
}

function channelOf(server: DirectMcpServer, name: string): ChannelInstance {
  const channel = scopeOf(server).channels?.findByName(name);
  if (!channel) throw new Error(`channel ${name} is not registered`);
  return channel;
}

/** Wait for fire-and-forget channel deliveries. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
}

describe('channels', () => {
  let server: DirectMcpServer;
  let client: DirectClient;
  const received: Array<{ content: string; meta: Record<string, string> }> = [];

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'channel-lifecycle', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
      channels: { enabled: true, defaultMeta: { server: 'desk', room: 'default' } },
    });
    client = await server.connect({ capabilities: { experimental: { 'claude/channel': {} } } });
    client.onNotification((notification) => {
      if (notification.method !== 'notifications/claude/channel') return;
      received.push(notification.params as { content: string; meta: Record<string, string> });
    });
  });

  afterAll(async () => {
    await client?.close();
    if (!lifecycle.includes('disconnect')) await server.dispose();
  });

  beforeEach(() => {
    received.length = 0;
    sends.length = 0;
  });

  it('runs channels:send-notification for each notification a channel pushes', async () => {
    await client.callTool('raise', { event: 'alert', text: 'disk full' });
    await settle();

    expect(sends).toEqual([{ channel: 'alerts', content: 'disk full' }]);
    expect(received).toEqual([{ content: 'disk full', meta: { server: 'desk', room: 'default', source: 'alerts' } }]);
  });

  it("layers defaultMeta under the channel's meta and the event's meta", async () => {
    await channelOf(server, 'chat').handleEvent({ text: 'hello' });
    await settle();

    expect(received).toEqual([
      { content: 'hello', meta: { server: 'desk', room: 'ops', kind: 'chat', source: 'chat' } },
    ]);
  });

  it('runs the flow for a manual scope.channelNotifications.send()', async () => {
    await scopeOf(server).channelNotifications?.send('alerts', 'manual push', { level: 'warn' });

    expect(sends).toEqual([{ channel: 'alerts', content: 'manual push' }]);
    expect(received).toEqual([
      { content: 'manual push', meta: { server: 'desk', room: 'default', level: 'warn', source: 'alerts' } },
    ]);
  });

  it('delivers a session-targeted push only to that session, through the flow', async () => {
    const alerts = channelOf(server, 'alerts');
    await alerts.pushNotification('for another session', {}, 'some-other-session');
    await alerts.pushNotification('for this session', {}, client.getSessionId());

    expect(sends.map((send) => send.content)).toEqual(['for another session', 'for this session']);
    expect(received.map((notification) => notification.content)).toEqual(['for this session']);
  });

  it('buffers for replay only the global notifications the flow sends', async () => {
    const alerts = channelOf(server, 'alerts');
    alerts.clearReplayBuffer();

    await alerts.pushNotification('global one');
    await alerts.pushNotification('targeted', {}, client.getSessionId());
    await alerts.pushNotification('classified global');
    await alerts.pushNotification('global two');
    await alerts.pushNotification('global three');

    expect(alerts.replayBuffer.map((notification) => notification.content)).toEqual(['global two', 'global three']);
    expect(alerts.replayBuffer[0].meta).toEqual({ server: 'desk', room: 'default', source: 'alerts' });
  });

  it('lets a hook stop a notification', async () => {
    await client.callTool('raise', { event: 'alert', text: 'classified report' });
    await settle();

    expect(sends).toEqual([{ channel: 'alerts', content: 'classified report' }]);
    expect(received).toEqual([]);
  });

  it('subscribes the session to the channels channels:list returns', async () => {
    await client.callTool('raise', { event: 'muted', text: 'not for this session' });
    await settle();

    expect(received).toEqual([]);
  });

  it('answers channel-reply with an error when onReply() throws', async () => {
    const failed = (await client.callTool('channel-reply', { channel_name: 'chat', text: 'boom' })) as {
      isError?: boolean;
      content: Array<{ text?: string }>;
    };
    expect(failed.isError).toBe(true);
    expect(failed.content[0].text).toContain('chat service refused the reply');

    const ok = (await client.callTool('channel-reply', { channel_name: 'chat', text: 'on it' })) as {
      isError?: boolean;
    };
    expect(ok.isError).toBeFalsy();
    expect(lifecycle).toContain('reply:on it');
  });

  it('calls onDisconnect() when the server is disposed', async () => {
    expect(lifecycle).toContain('connect');
    expect(lifecycle).not.toContain('disconnect');

    await server.dispose();

    expect(lifecycle).toContain('disconnect');
  });
});
