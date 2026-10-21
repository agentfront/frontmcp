const NODE_TRANSPORT_MODULE = '@modelcontextprotocol/sdk/server/streamableHttp.js';

describe('lazy-mcp-streamable-http', () => {
  afterEach(() => {
    jest.dontMock(NODE_TRANSPORT_MODULE);
    jest.resetModules();
  });

  it('loads the Node HTTP transport the first time it is read', () => {
    const loadTransportModule = jest.fn(() => ({
      StreamableHTTPServerTransport: class StreamableHTTPServerTransport {},
    }));
    jest.doMock(NODE_TRANSPORT_MODULE, loadTransportModule);

    jest.isolateModules(() => {
      const lazyTransport = require('../lazy-mcp-streamable-http');
      expect(loadTransportModule).not.toHaveBeenCalled();

      expect(lazyTransport.StreamableHTTPServerTransport.name).toBe('StreamableHTTPServerTransport');
      expect(loadTransportModule).toHaveBeenCalledTimes(1);
    });
  });

  it('exports the classes the eager module exports', () => {
    const lazyTransport = require('../lazy-mcp-streamable-http');
    const eagerTransport = require('../node-mcp-streamable-http');

    expect(Object.keys(lazyTransport).sort()).toEqual([
      'StreamableHTTPServerTransport',
      'WebStandardStreamableHTTPServerTransport',
    ]);
    expect(lazyTransport.StreamableHTTPServerTransport).toBe(eagerTransport.StreamableHTTPServerTransport);
    expect(lazyTransport.WebStandardStreamableHTTPServerTransport).toBe(
      eagerTransport.WebStandardStreamableHTTPServerTransport,
    );
  });
});
