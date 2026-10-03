import 'reflect-metadata';

import { type FrontMcpLogger } from '../../common';
import type { NotificationService } from '../../notification/notification.service';
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
