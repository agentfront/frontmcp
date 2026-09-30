import { EventEmitter } from 'events';

import { attachRedisErrorListener } from '../redis-error-listener';

describe('attachRedisErrorListener', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('registers a listener so an emitted error does not throw', () => {
    const client = new EventEmitter();
    const logger = { warn: jest.fn() };
    attachRedisErrorListener(client, { logger });

    expect(() => client.emit('error', new Error('ECONNREFUSED'))).not.toThrow();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain('ECONNREFUSED');
  });

  it('logs at most once per interval and reports the suppressed count', () => {
    const client = new EventEmitter();
    const logger = { warn: jest.fn() };
    attachRedisErrorListener(client, { logger, intervalMs: 1000, label: 'HA' });

    client.emit('error', new Error('a'));
    client.emit('error', new Error('b'));
    client.emit('error', new Error('c'));
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain('[HA]');

    jest.advanceTimersByTime(1001);
    client.emit('error', new Error('d'));
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn.mock.calls[1][0]).toContain('2 similar error(s) suppressed');
  });

  it('falls back to console.warn when no logger is given', () => {
    const client = new EventEmitter();
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    attachRedisErrorListener(client);
    client.emit('error', new Error('boom'));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('returns a detach function', () => {
    const client = new EventEmitter();
    const detach = attachRedisErrorListener(client, { logger: { warn: jest.fn() } });
    expect(client.listenerCount('error')).toBe(1);
    detach();
    expect(client.listenerCount('error')).toBe(0);
  });
});
