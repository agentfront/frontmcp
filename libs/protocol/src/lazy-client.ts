// The `require` variant of `#client`: each export loads its MCP SDK module the first time it is read, so a server never loads the client.
Object.defineProperties(exports, {
  Client: {
    enumerable: true,
    get: () => require('./compat-client').Client,
  },
  StreamableHTTPClientTransport: {
    enumerable: true,
    get: () => require('./compat-client').StreamableHTTPClientTransport,
  },
  SSEClientTransport: {
    enumerable: true,
    get: () => require('@modelcontextprotocol/client').SSEClientTransport,
  },
  StdioClientTransport: {
    enumerable: true,
    get: () => require('#stdio-client').StdioClientTransport,
  },
});
