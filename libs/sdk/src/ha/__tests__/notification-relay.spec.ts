import { NotificationRelay, type RelayRedisClient } from '../notification-relay';
import { isRequestRelayMessage, type HaRelayMessage } from '../relay-messages';

function createClient() {
  const handlers: Array<(channel: string, message: string) => void> = [];
  const client = {
    subscribe: jest.fn().mockResolvedValue(1),
    unsubscribe: jest.fn().mockResolvedValue(1),
    publish: jest.fn().mockResolvedValue(1),
    on: jest.fn((_event: 'message', handler: (channel: string, message: string) => void) => handlers.push(handler)),
    removeAllListeners: jest.fn(),
    removeListener: jest.fn((_event: 'message', handler: (channel: string, message: string) => void) => {
      const index = handlers.indexOf(handler);
      if (index >= 0) handlers.splice(index, 1);
    }),
    emit: (channel: string, message: string) => handlers.forEach((handler) => handler(channel, message)),
    handlerCount: () => handlers.length,
  };
  return client as typeof client & RelayRedisClient;
}

describe('NotificationRelay', () => {
  it("subscribes to this pod's channel and hands it every relay message", async () => {
    const subscriber = createClient();
    const relay = new NotificationRelay(subscriber, createClient(), 'pod-a');
    const handler = jest.fn();

    await relay.subscribe(handler);
    // A second subscribe (retry) does not register the listener twice.
    await relay.subscribe(handler);
    expect(subscriber.subscribe).toHaveBeenCalledWith('mcp:ha:notify:pod-a');
    expect(subscriber.handlerCount()).toBe(1);

    const message: HaRelayMessage = { kind: 'relay-cancel', requestId: 'r1', sourceNodeId: 'pod-b' };
    subscriber.emit('mcp:ha:notify:pod-a', JSON.stringify(message));
    expect(handler).toHaveBeenCalledWith(message);
  });

  it('ignores other channels, malformed and non-object messages', async () => {
    const subscriber = createClient();
    const relay = new NotificationRelay(subscriber, createClient(), 'pod-a');
    const handler = jest.fn();
    await relay.subscribe(handler);

    subscriber.emit('mcp:ha:notify:pod-b', JSON.stringify({ kind: 'relay-cancel' }));
    subscriber.emit('mcp:ha:notify:pod-a', '{not json');
    subscriber.emit('mcp:ha:notify:pod-a', '42');
    subscriber.emit('mcp:ha:notify:pod-a', 'null');

    expect(handler).not.toHaveBeenCalled();
  });

  it('survives a handler that throws or rejects', async () => {
    const subscriber = createClient();
    const relay = new NotificationRelay(subscriber, createClient(), 'pod-a');
    await relay.subscribe(() => {
      throw new Error('sync');
    });
    expect(() => subscriber.emit('mcp:ha:notify:pod-a', '{"kind":"relay-cancel"}')).not.toThrow();

    await relay.subscribe(async () => {
      throw new Error('async');
    });
    expect(() => subscriber.emit('mcp:ha:notify:pod-a', '{"kind":"relay-cancel"}')).not.toThrow();
  });

  it('publishes notifications and any relay message to the target pod', async () => {
    const publisher = createClient();
    publisher.publish.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const relay = new NotificationRelay(createClient(), publisher, 'pod-a', { redisKeyPrefix: 'app:ha:' });

    await relay.publish('pod-b', 'sess-1', { method: 'notifications/tools/list_changed' });
    const sent = JSON.parse(publisher.publish.mock.calls[0][1] as string);
    expect(publisher.publish.mock.calls[0][0]).toBe('app:ha:notify:pod-b');
    expect(sent).toEqual(
      expect.objectContaining({
        kind: 'notification',
        sessionId: 'sess-1',
        notification: { method: 'notifications/tools/list_changed' },
        sourceNodeId: 'pod-a',
      }),
    );

    await expect(relay.send('pod-c', { kind: 'relay-cancel', requestId: 'r1', sourceNodeId: 'pod-a' })).resolves.toBe(
      0,
    );
    expect(relay.channelOf('pod-c')).toBe('app:ha:notify:pod-c');
  });

  it('stops delivering after unsubscribe, even if Redis fails to unsubscribe', async () => {
    const subscriber = createClient();
    subscriber.unsubscribe.mockRejectedValueOnce(new Error('closed'));
    const relay = new NotificationRelay(subscriber, createClient(), 'pod-a');
    const handler = jest.fn();
    await relay.subscribe(handler);

    await relay.unsubscribe();
    subscriber.emit('mcp:ha:notify:pod-a', '{"kind":"relay-cancel"}');
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('isRequestRelayMessage', () => {
  it('recognizes the request relay kinds only', () => {
    expect(isRequestRelayMessage({ kind: 'relay-cancel', requestId: 'r', sourceNodeId: 'a' })).toBe(true);
    expect(
      isRequestRelayMessage({
        kind: 'relay-response',
        requestId: 'r',
        sourceNodeId: 'a',
        event: 'end',
      }),
    ).toBe(true);
    expect(
      isRequestRelayMessage({
        kind: 'relay-request',
        requestId: 'r',
        sourceNodeId: 'a',
        sessionId: 's',
        request: { method: 'GET', url: '/', path: '/', headers: {}, query: {} },
        timestamp: 0,
      }),
    ).toBe(true);
    expect(
      isRequestRelayMessage({ sessionId: 's', notification: { method: 'm' }, sourceNodeId: 'a', timestamp: 0 }),
    ).toBe(false);
    expect(isRequestRelayMessage({ kind: 'destroy-session', sessionId: 's', sourceNodeId: 'a', timestamp: 0 })).toBe(
      false,
    );
  });
});
