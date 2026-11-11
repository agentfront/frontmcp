import 'reflect-metadata';

import { type FrontMcpLogger } from '../../common';
import { NotificationService } from '../../notification/notification.service';
import { ChannelNotificationService } from '../channel-notification.service';

function logger(): FrontMcpLogger & { error: jest.Mock } {
  const log = { error: jest.fn(), warn: jest.fn(), verbose: jest.fn(), info: jest.fn() } as Record<string, unknown>;
  log['child'] = () => log;
  return log as unknown as FrontMcpLogger & { error: jest.Mock };
}

function notifications(): NotificationService & { sendCustomNotification: jest.Mock } {
  return {
    getSubscribersForChannel: jest.fn(() => ['session-1']),
    getRegisteredServer: jest.fn(() => ({ clientCapabilities: { experimental: { 'claude/channel': {} } } })),
    isChannelSubscribed: jest.fn(() => true),
    sendCustomNotification: jest.fn(),
  } as unknown as NotificationService & { sendCustomNotification: jest.Mock };
}

describe('ChannelNotificationService.send', () => {
  it('exposes the server defaultMeta', () => {
    const service = new ChannelNotificationService(notifications(), logger(), { server: 'desk' });
    expect(service.defaultMeta).toEqual({ server: 'desk' });
    expect(new ChannelNotificationService(notifications(), logger()).defaultMeta).toEqual({});
  });

  it('runs the send flow when the scope wires one', async () => {
    const flow = jest.fn(async () => ({ sent: true }));
    const service = new ChannelNotificationService(notifications(), logger(), { server: 'desk' }, flow);

    await service.send('status', 'maintenance', { level: 'warn' });

    expect(flow).toHaveBeenCalledWith({ channelName: 'status', content: 'maintenance', meta: { level: 'warn' } });
  });

  it('logs a failing flow instead of throwing', async () => {
    const log = logger();
    const service = new ChannelNotificationService(notifications(), log, undefined, async () => {
      throw new Error('hook refused');
    });

    await expect(service.send('status', 'maintenance')).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith('Channel "status" notification failed', expect.anything());
  });

  it('delivers directly with defaultMeta when no flow is wired', async () => {
    const sink = notifications();
    const service = new ChannelNotificationService(sink, logger(), { server: 'desk', level: 'info' });

    await service.send('status', 'maintenance', { level: 'warn' });

    expect(sink.sendCustomNotification).toHaveBeenCalledWith(
      'notifications/claude/channel',
      { content: 'maintenance', meta: { server: 'desk', level: 'warn', source: 'status' } },
      expect.any(Function),
    );
  });
});

describe('ChannelNotificationService meta keys', () => {
  const unsafeMeta = { source: 'chat', 'chat-id': '42', 'sender.name': 'ada' };
  const safeMeta = { source: 'chat', chat_id: '42', sender_name: 'ada' };

  it('sends a key Claude Code would drop with an underscore in its place, to the subscribed sessions', () => {
    const sink = notifications();
    const service = new ChannelNotificationService(sink, logger());

    service.sendToSubscribedSessions('hello', unsafeMeta);

    expect(sink.sendCustomNotification).toHaveBeenCalledWith(
      'notifications/claude/channel',
      { content: 'hello', meta: safeMeta },
      expect.any(Function),
    );
  });

  it('does the same for a notification sent to one session', () => {
    const sink = notifications();
    const service = new ChannelNotificationService(sink, logger());

    service.sendToSession('session-1', 'hello', unsafeMeta);

    expect(sink.sendCustomNotification).toHaveBeenCalledWith(
      'notifications/claude/channel',
      { content: 'hello', meta: safeMeta },
      expect.any(Function),
    );
  });

  it('does the same for a listener with no session', () => {
    const service = new ChannelNotificationService(notifications(), logger());
    const deliver = jest.fn();
    service.listen(['chat'], deliver);

    service.sendToSubscribedSessions('hello', unsafeMeta);

    expect(deliver).toHaveBeenCalledWith('hello', safeMeta);
  });
});

describe('ChannelNotificationService channel capable sessions', () => {
  const CHANNEL_EVENT = { content: 'disk full', meta: { source: 'alerts' } };

  /** A channel service over real sessions: one session, subscribed to `alerts`, connected as `connection` says. */
  function subscribedSession(connection: { stdio?: boolean }) {
    const log = logger();
    const registries = { subscribe: jest.fn() };
    const scope = { logger: log, resources: registries, tools: registries, prompts: registries };
    const sessions = new NotificationService(scope as never);
    const notification = jest.fn();
    sessions.registerServer('session-1', { notification } as never, connection);
    sessions.subscribeChannel('session-1', 'alerts');
    return { service: new ChannelNotificationService(sessions, log), sessions, notification };
  }

  it('sends to the stdio session, which declares no capability', () => {
    const { service, notification } = subscribedSession({ stdio: true });

    service.sendToSubscribedSessions(CHANNEL_EVENT.content, CHANNEL_EVENT.meta);
    const targeted = service.sendToSession('session-1', CHANNEL_EVENT.content, CHANNEL_EVENT.meta);

    expect(targeted).toBe(true);
    expect(notification.mock.calls).toEqual([
      [{ method: 'notifications/claude/channel', params: CHANNEL_EVENT }],
      [{ method: 'notifications/claude/channel', params: CHANNEL_EVENT }],
    ]);
  });

  it('sends nothing to an HTTP session that declared no capability', () => {
    const { service, sessions, notification } = subscribedSession({});
    sessions.setClientCapabilities('session-1', { roots: { listChanged: true } });

    service.sendToSubscribedSessions(CHANNEL_EVENT.content, CHANNEL_EVENT.meta);
    const targeted = service.sendToSession('session-1', CHANNEL_EVENT.content, CHANNEL_EVENT.meta);

    expect(targeted).toBe(false);
    expect(notification).not.toHaveBeenCalled();
  });

  it('sends to an HTTP session once its client declared claude/channel', () => {
    const { service, sessions, notification } = subscribedSession({});
    sessions.setClientCapabilities('session-1', { experimental: { 'claude/channel': {} } });

    service.sendToSubscribedSessions(CHANNEL_EVENT.content, CHANNEL_EVENT.meta);

    expect(notification).toHaveBeenCalledWith({ method: 'notifications/claude/channel', params: CHANNEL_EVENT });
  });
});
