import { meetsLogLevel, RequestNotificationSink } from '../request-notifications';

describe('meetsLogLevel', () => {
  it('accepts a level at or above the minimum', () => {
    expect(meetsLogLevel('warning', 'info')).toBe(true);
    expect(meetsLogLevel('info', 'info')).toBe(true);
    expect(meetsLogLevel('emergency', 'debug')).toBe(true);
  });

  it('rejects a level below the minimum', () => {
    expect(meetsLogLevel('debug', 'warning')).toBe(false);
    expect(meetsLogLevel('info', 'error')).toBe(false);
  });

  it('lets unknown levels through rather than silently dropping them', () => {
    expect(meetsLogLevel('bogus' as never, 'error')).toBe(true);
    expect(meetsLogLevel('error', 'bogus' as never)).toBe(true);
  });
});

describe('RequestNotificationSink', () => {
  it('is inactive when the client opted into nothing', () => {
    expect(new RequestNotificationSink(undefined, undefined).active).toBe(false);
  });

  it('is active when a log level was requested', () => {
    expect(new RequestNotificationSink('info', undefined).active).toBe(true);
  });

  it('is active when a progress token was supplied', () => {
    expect(new RequestNotificationSink(undefined, 'tok').active).toBe(true);
  });

  it('drops log messages when no level was requested', () => {
    // The spec makes this a MUST NOT, not a preference.
    const sink = new RequestNotificationSink(undefined, 'tok');
    expect(sink.log('error', 'tool', { message: 'x' })).toBe(false);
    expect(sink.drain()).toEqual([]);
  });

  it('queues log messages at or above the requested level', () => {
    const sink = new RequestNotificationSink('warning', undefined);

    expect(sink.log('info', 'tool', { message: 'quiet' })).toBe(false);
    expect(sink.log('error', 'tool', { message: 'loud' })).toBe(true);

    expect(sink.drain()).toEqual([
      { method: 'notifications/message', params: { level: 'error', logger: 'tool', data: { message: 'loud' } } },
    ]);
  });

  it('omits the logger field when no name was supplied', () => {
    const sink = new RequestNotificationSink('debug', undefined);
    sink.log('debug', undefined, { message: 'x' });
    expect(sink.drain()[0]?.params).toEqual({ level: 'debug', data: { message: 'x' } });
  });

  it('drops progress when no token was supplied', () => {
    const sink = new RequestNotificationSink('debug', undefined);
    expect(sink.progress(1, 2, 'half')).toBe(false);
    expect(sink.drain()).toEqual([]);
  });

  it('queues progress with the client token', () => {
    const sink = new RequestNotificationSink(undefined, 'tok-1');
    expect(sink.progress(1, 3, 'step 1')).toBe(true);

    expect(sink.drain()).toEqual([
      {
        method: 'notifications/progress',
        params: { progressToken: 'tok-1', progress: 1, total: 3, message: 'step 1' },
      },
    ]);
  });

  it('omits optional progress fields that were not supplied', () => {
    const sink = new RequestNotificationSink(undefined, 7);
    sink.progress(1);
    expect(sink.drain()[0]?.params).toEqual({ progressToken: 7, progress: 1 });
  });

  it('drains everything queued and empties the buffer', () => {
    const sink = new RequestNotificationSink('debug', 'tok');
    sink.log('info', 'a', {});
    sink.progress(1);

    expect(sink.drain()).toHaveLength(2);
    expect(sink.drain()).toEqual([]);
  });

  it('stops accepting notifications once closed', () => {
    const sink = new RequestNotificationSink('debug', 'tok');
    sink.close();
    sink.log('error', 'a', {});

    expect(sink.closed).toBe(true);
    expect(sink.drain()).toEqual([]);
  });

  it('resolves waitForActivity immediately when work is pending', async () => {
    const sink = new RequestNotificationSink('debug', undefined);
    sink.log('info', 'a', {});
    await expect(sink.waitForActivity()).resolves.toBeUndefined();
  });

  it('resolves waitForActivity immediately once closed', async () => {
    const sink = new RequestNotificationSink('debug', undefined);
    sink.close();
    await expect(sink.waitForActivity()).resolves.toBeUndefined();
  });

  it('wakes a waiter when a notification arrives', async () => {
    const sink = new RequestNotificationSink('debug', undefined);
    const waiting = sink.waitForActivity();
    sink.log('info', 'a', { message: 'hi' });

    await expect(waiting).resolves.toBeUndefined();
    expect(sink.drain()).toHaveLength(1);
  });

  it('wakes a waiter when the sink closes', async () => {
    // Otherwise the streaming loop would hang forever on a silent request.
    const sink = new RequestNotificationSink('debug', undefined);
    const waiting = sink.waitForActivity();
    sink.close();
    await expect(waiting).resolves.toBeUndefined();
  });
});
