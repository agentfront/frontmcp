/**
 * createHaRedisClient (#1503): the HA subscriber of an app's own client is a copy FrontMCP opens,
 * listens to and closes.
 */
import { createHaRedisClient } from '../ha-redis-client';

function nodeRedisClient() {
  return {
    isOpen: true,
    sendCommand: jest.fn(),
    connect: jest.fn(),
    duplicate: jest.fn(),
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    on: jest.fn(),
    removeListener: jest.fn(),
    close: jest.fn(),
  };
}

describe("createHaRedisClient with the app's node-redis client", () => {
  it("gives the subscriber copy an 'error' listener, which node-redis needs to not throw", () => {
    const copy = nodeRedisClient();
    const appClient = { ...nodeRedisClient(), duplicate: jest.fn(() => copy) };
    const logger = { warn: jest.fn() };

    createHaRedisClient({ client: appClient }, 'ha-subscriber', logger);

    expect(appClient.duplicate).toHaveBeenCalledTimes(1);
    const [event, listener] = copy.on.mock.calls.find(([name]) => name === 'error') ?? [];
    expect(event).toBe('error');
    (listener as (error: Error) => void)(new Error('connection lost'));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('[ha-subscriber] Redis connection error: connection lost'),
    );
    // The app's own client gets no listener from FrontMCP
    expect(appClient.on).not.toHaveBeenCalled();
  });

  it("uses the app's client itself for commands, without a listener", () => {
    const appClient = nodeRedisClient();

    createHaRedisClient({ client: appClient }, 'ha');

    expect(appClient.duplicate).not.toHaveBeenCalled();
    expect(appClient.on).not.toHaveBeenCalled();
  });
});
