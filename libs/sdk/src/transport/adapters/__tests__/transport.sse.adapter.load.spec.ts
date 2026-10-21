import 'reflect-metadata';

import { InternalMcpError } from '../../../errors';
import { RecreateableSSEServerTransport } from '../sse-transport';
import { loadSseTransport, TransportSSEAdapter } from '../transport.sse.adapter';

jest.mock('../sse-transport', () => ({
  RecreateableSSEServerTransport: jest.fn().mockImplementation(() => ({})),
}));

function makeAdapter(): TransportSSEAdapter {
  const adapter = Object.create(TransportSSEAdapter.prototype) as TransportSSEAdapter;
  Object.assign(adapter, {
    logger: { info: jest.fn(), verbose: jest.fn() },
    scope: { fullPath: '/mcp' },
  });
  return adapter;
}

describe('TransportSSEAdapter loads its transport class on demand', () => {
  it('refuses to create a transport before loadSseTransport() loaded the class', () => {
    expect(() => makeAdapter().createTransport('session-1', {} as never)).toThrow(InternalMcpError);
    expect(RecreateableSSEServerTransport).not.toHaveBeenCalled();
  });

  it('creates and recreates transports with the loaded class', async () => {
    await loadSseTransport();
    const response = {} as never;

    makeAdapter().createTransport('session-1', response);
    makeAdapter().createTransportFromSession('session-2', response, 41);

    expect(RecreateableSSEServerTransport).toHaveBeenNthCalledWith(1, '/mcp/message', response, {
      sessionId: 'session-1',
    });
    expect(RecreateableSSEServerTransport).toHaveBeenNthCalledWith(2, '/mcp/message', response, {
      sessionId: 'session-2',
      initialEventId: 41,
    });
  });
});
