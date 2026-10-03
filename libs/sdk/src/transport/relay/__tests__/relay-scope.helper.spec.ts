import type { HaManager, HaRelayMessage } from '../../../ha';
import type { RedisTransportBus } from '../../bus/redis-transport-bus';
import type { TransportService } from '../../transport.registry';
import { wireSessionRelay } from '../relay-scope.helper';
import { SessionRelay } from '../session-relay';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a relay handle');
  return value;
}

function setup(options: { relay?: boolean; subscribe?: jest.Mock } = {}) {
  let handler: ((message: HaRelayMessage) => void) | undefined;
  const subscribe =
    options.subscribe ??
    jest.fn(async (h: (message: HaRelayMessage) => void) => {
      handler = h;
    });
  const haManager = {
    getRelay: jest.fn(() => (options.relay === false ? undefined : {})),
    getConfig: jest.fn(() => ({ heartbeatIntervalMs: 2000, heartbeatTtlMs: 6500 })),
    publishToNode: jest.fn().mockResolvedValue(1),
    isNodeAlive: jest.fn().mockResolvedValue(true),
    subscribeRelay: jest.fn((h: (message: HaRelayMessage) => void) => {
      handler = h;
      return subscribe(h);
    }),
  };
  const bus = { attachRelay: jest.fn() };
  const transportService = { destroyLocalSession: jest.fn().mockResolvedValue(true) };
  const notifications = { deliverRelayedNotification: jest.fn().mockReturnValue(true) };
  const flows = { runFlow: jest.fn() };
  const logger = { info: jest.fn(), warn: jest.fn() };

  const handle = wireSessionRelay({
    nodeId: 'node-a',
    haManager: haManager as unknown as HaManager,
    bus: bus as unknown as RedisTransportBus,
    transportService: transportService as unknown as TransportService,
    notifications,
    flows,
    logger,
  });
  return {
    handle,
    haManager,
    bus,
    transportService,
    notifications,
    flows,
    logger,
    deliver: (message: HaRelayMessage) => handler?.(message),
  };
}

describe('wireSessionRelay', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('does nothing without pub/sub connections', () => {
    expect(setup({ relay: false }).handle).toBeUndefined();
  });

  it('subscribes to the relay channel, then lets the bus relay', async () => {
    const { handle, bus, logger } = setup();
    await handle?.ready;
    expect(bus.attachRelay).toHaveBeenCalledWith(handle?.relay);
    expect(handle?.relay).toBeInstanceOf(SessionRelay);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Request relay ready'));
    expect(handle?.relay.unreachable('node-b', 'x').retryAfterSeconds).toBe(7);
  });

  it('dispatches each kind of relay message', async () => {
    const { handle, deliver, transportService, notifications } = setup();
    await handle?.ready;
    const handleMessage = jest.spyOn(required(handle).relay, 'handleMessage');

    deliver({ kind: 'relay-cancel', requestId: 'r', sourceNodeId: 'node-b' });
    expect(handleMessage).toHaveBeenCalledTimes(1);

    deliver({ kind: 'destroy-session', sessionId: 'sess-1', reason: 'bye', sourceNodeId: 'node-b', timestamp: 0 });
    expect(transportService.destroyLocalSession).toHaveBeenCalledWith('sess-1', 'bye');

    deliver({
      kind: 'notification',
      sessionId: 'sess-1',
      notification: { method: 'notifications/tools/list_changed' },
      sourceNodeId: 'node-b',
      timestamp: 0,
    });
    deliver({
      sessionId: 'sess-2',
      notification: { method: 'notifications/message', params: { level: 'info' } },
      sourceNodeId: 'node-b',
      timestamp: 0,
    });
    expect(notifications.deliverRelayedNotification).toHaveBeenCalledWith(
      'sess-1',
      'notifications/tools/list_changed',
      undefined,
    );
    expect(notifications.deliverRelayedNotification).toHaveBeenCalledWith('sess-2', 'notifications/message', {
      level: 'info',
    });

    deliver({ kind: 'unknown' } as unknown as HaRelayMessage);
    expect(notifications.deliverRelayedNotification).toHaveBeenCalledTimes(2);
  });

  it('logs a remote destroy that fails', async () => {
    const { handle, deliver, transportService, logger } = setup();
    await handle?.ready;
    transportService.destroyLocalSession.mockRejectedValueOnce(new Error('gone'));

    deliver({ kind: 'destroy-session', sessionId: 'sess-1', sourceNodeId: 'node-b', timestamp: 0 });
    await new Promise((resolve) => setImmediate(resolve));

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to destroy'), {
      sessionId: 'sess-1',
      error: 'gone',
    });
  });

  it('serves relayed requests through the scope flows', async () => {
    const { handle, flows } = setup();
    await handle?.ready;
    flows.runFlow.mockResolvedValue(undefined);

    handle?.relay.handleMessage({
      kind: 'relay-request',
      requestId: 'r1',
      sourceNodeId: 'node-b',
      sessionId: 'sess-1',
      request: { method: 'POST', url: '/', path: '/', headers: {}, query: {} },
      timestamp: 0,
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(flows.runFlow).toHaveBeenCalledWith('http:request', expect.any(Object));
  });

  it('retries the subscription with backoff while Redis is unreachable', async () => {
    jest.useFakeTimers();
    const subscribe = jest
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce('down')
      .mockResolvedValue(undefined);
    const { handle, bus, logger } = setup({ subscribe });

    await jest.advanceTimersByTimeAsync(0);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('retrying in 1000ms'), {
      error: 'ECONNREFUSED',
    });
    await jest.advanceTimersByTimeAsync(1000);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('retrying in 2000ms'), { error: 'down' });
    expect(bus.attachRelay).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(2000);
    await handle?.ready;
    expect(subscribe).toHaveBeenCalledTimes(3);
    expect(bus.attachRelay).toHaveBeenCalledWith(handle?.relay);
  });

  it('close() stops retrying, detaches the relay and closes it', async () => {
    jest.useFakeTimers();
    const subscribe = jest.fn().mockRejectedValue(new Error('down'));
    const { handle, bus } = setup({ subscribe });
    await jest.advanceTimersByTimeAsync(0);

    const close = jest.spyOn(required(handle).relay, 'close');
    await handle?.close();
    await jest.advanceTimersByTimeAsync(60_000);
    await handle?.ready;

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(bus.attachRelay).toHaveBeenLastCalledWith(undefined);
    expect(close).toHaveBeenCalled();
  });

  it('does not attach a relay whose subscription completes after close()', async () => {
    let finish: () => void = () => undefined;
    const subscribe = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { handle, bus } = setup({ subscribe });
    await handle?.close();
    finish();
    await handle?.ready;
    expect(bus.attachRelay).toHaveBeenCalledTimes(1);
    expect(bus.attachRelay).toHaveBeenCalledWith(undefined);
  });

  it('stops before subscribing when closed during a retry', async () => {
    jest.useFakeTimers();
    const subscribe = jest.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(undefined);
    const { handle } = setup({ subscribe });
    await jest.advanceTimersByTimeAsync(0);
    const ready = handle?.ready;
    await handle?.close();
    await expect(ready).resolves.toBeUndefined();
  });
});
