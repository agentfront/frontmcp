/**
 * Notifications for sessions another pod owns are relayed to that pod (#680).
 * They used to be published to `notify:{sessionId}` — a channel nobody listens on.
 */
import { NotificationService } from '../notification.service';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function createScope(options: {
  owner?: { nodeId: string; channel: string };
  lookupError?: Error;
  relay?: boolean;
  transportService?: boolean;
}) {
  const relay = { publish: jest.fn().mockResolvedValue(undefined) };
  const logger = { verbose: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const scope = {
    logger: { ...logger, child: jest.fn(() => logger) },
    providers: { cleanupSession: jest.fn() },
    resources: { subscribe: jest.fn(() => () => undefined) },
    tools: { subscribe: jest.fn(() => () => undefined) },
    prompts: { subscribe: jest.fn(() => () => undefined) },
    haManager: {
      getRelay: jest.fn(() => (options.relay === false ? undefined : relay)),
      getNodeId: jest.fn(() => 'pod-local'),
    },
    transportService:
      options.transportService === false
        ? undefined
        : {
            lookupSessionOwner: options.lookupError
              ? jest.fn().mockRejectedValue(options.lookupError)
              : jest.fn().mockResolvedValue(options.owner),
          },
  };
  return { scope, relay, logger };
}

describe('NotificationService — HA relay', () => {
  it("publishes a non-local session's notification to the pod that owns it", async () => {
    const { scope, relay } = createScope({ owner: { nodeId: 'pod-a', channel: 'mcp:ha:notify:pod-a' } });
    const service = new NotificationService(scope as never);

    service.sendNotificationToSession('sess-remote', 'notifications/resources/updated', { uri: 'file://x' });
    await flush();

    expect(scope.transportService?.lookupSessionOwner).toHaveBeenCalledWith('sess-remote');
    expect(relay.publish).toHaveBeenCalledWith('pod-a', 'sess-remote', {
      method: 'notifications/resources/updated',
      params: { uri: 'file://x' },
    });
  });

  it('drops the notification when no pod owns the session, or it is this one', async () => {
    const unknown = createScope({ owner: undefined });
    new NotificationService(unknown.scope as never).sendNotificationToSession(
      'sess-x',
      'notifications/tools/list_changed',
    );
    await flush();
    expect(unknown.relay.publish).not.toHaveBeenCalled();
    expect(unknown.logger.warn).toHaveBeenCalledWith(expect.stringContaining('unregistered session'));

    const self = createScope({ owner: { nodeId: 'pod-local', channel: 'c' } });
    new NotificationService(self.scope as never).sendNotificationToSession(
      'sess-x',
      'notifications/tools/list_changed',
    );
    await flush();
    expect(self.relay.publish).not.toHaveBeenCalled();
  });

  it('logs a relay that fails', async () => {
    const { scope, relay, logger } = createScope({ lookupError: new Error('redis down') });
    new NotificationService(scope as never).sendNotificationToSession('sess-x', 'notifications/tools/list_changed');
    await flush();
    expect(relay.publish).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to relay notification'));
  });

  it('warns without relaying when HA is not running', async () => {
    const { scope, relay, logger } = createScope({ relay: false });
    new NotificationService(scope as never).sendNotificationToSession('sess-x', 'notifications/tools/list_changed');
    await flush();
    expect(relay.publish).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('unregistered session'));

    const noTransport = createScope({ transportService: false });
    new NotificationService(noTransport.scope as never).sendNotificationToSession(
      'sess-x',
      'notifications/tools/list_changed',
    );
    await flush();
    expect(noTransport.relay.publish).not.toHaveBeenCalled();
  });

  describe('deliverRelayedNotification', () => {
    it('delivers to a session served here', () => {
      const { scope } = createScope({});
      const service = new NotificationService(scope as never);
      const server = { notification: jest.fn(), request: jest.fn() };
      service.registerServer('sess-local', server as never);

      expect(service.deliverRelayedNotification('sess-local', 'notifications/message', { level: 'info' })).toBe(true);
      expect(server.notification).toHaveBeenCalledWith({
        method: 'notifications/message',
        params: { level: 'info' },
      });
    });

    it('never relays a relayed notification further', async () => {
      const { scope, relay } = createScope({ owner: { nodeId: 'pod-a', channel: 'c' } });
      const service = new NotificationService(scope as never);

      expect(service.deliverRelayedNotification('sess-gone', 'notifications/message')).toBe(false);
      await flush();
      expect(relay.publish).not.toHaveBeenCalled();
    });
  });
});
