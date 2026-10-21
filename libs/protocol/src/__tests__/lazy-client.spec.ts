const CLIENT_EXPORTS = [
  'Client',
  'StreamableHTTPClientTransport',
  'SSEClientTransport',
  'StdioClientTransport',
] as const;
const MCP_CLIENT_MODULE = '@modelcontextprotocol/sdk/client/index.js';

describe('lazy-client', () => {
  afterEach(() => {
    jest.dontMock(MCP_CLIENT_MODULE);
    jest.resetModules();
  });

  it('loads the MCP SDK client the first time Client is read', () => {
    const loadClientModule = jest.fn(() => ({ Client: class Client {} }));
    jest.doMock(MCP_CLIENT_MODULE, loadClientModule);

    jest.isolateModules(() => {
      const lazyClient = require('../lazy-client');
      expect(loadClientModule).not.toHaveBeenCalled();

      expect(lazyClient.Client.name).toBe('Client');
      expect(loadClientModule).toHaveBeenCalledTimes(1);
    });
  });

  it('exports the classes the eager client module exports', () => {
    const lazyClient = require('../lazy-client');
    const eagerClient = require('../client');

    expect(Object.keys(lazyClient).sort()).toEqual([...CLIENT_EXPORTS].sort());
    for (const name of CLIENT_EXPORTS) {
      expect(lazyClient[name]).toBe(eagerClient[name]);
    }
    expect(typeof lazyClient.Client.prototype.connect).toBe('function');
  });
});
