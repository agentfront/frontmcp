import 'reflect-metadata';

import { TransportStreamableHttpAdapter } from '../transport.streamable-http.adapter';

const capturedOptions: Array<{ onsessioninitialized?: (sessionId: string | undefined) => void }> = [];

jest.mock('../streamable-http-transport', () => ({
  RecreateableStreamableHTTPServerTransport: jest.fn().mockImplementation((options) => {
    capturedOptions.push(options);
    return {};
  }),
}));

function makeAdapter(type: 'streamable-http' | 'stateless-http') {
  const adapter = Object.create(TransportStreamableHttpAdapter.prototype);
  adapter.logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), verbose: jest.fn(), debug: jest.fn() };
  adapter.key = { type, sessionId: 'session-123' };
  adapter.scope = { eventStore: undefined, notifications: { unregisterServer: jest.fn() } };
  adapter.transport = { close: jest.fn() };
  return adapter;
}

describe('transport adapters write lifecycle lines to the logger, not the console', () => {
  let consoleLog: jest.SpyInstance;

  beforeEach(() => {
    capturedOptions.length = 0;
    consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => consoleLog.mockRestore());

  it.each(['streamable-http', 'stateless-http'] as const)('logs session initialization at verbose (%s)', (type) => {
    const adapter = makeAdapter(type);
    adapter.createTransport('session-123', {});
    capturedOptions[0].onsessioninitialized?.(type === 'stateless-http' ? undefined : 'session-123');

    expect(consoleLog).not.toHaveBeenCalled();
    expect(adapter.logger.verbose).toHaveBeenCalledTimes(1);
    expect(adapter.logger.info).not.toHaveBeenCalled();
  });

  it('logs transport teardown at verbose', async () => {
    const adapter = makeAdapter('streamable-http');
    await adapter.destroy('session closed').catch(() => undefined);

    expect(consoleLog).not.toHaveBeenCalled();
    expect(adapter.logger.verbose).toHaveBeenCalledWith('destroying transporter', { reason: 'session closed' });
  });
});
