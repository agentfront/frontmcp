// The `require` variant of `#client`: each export loads its MCP SDK module the first time it is read, so a server never loads the client.
Object.defineProperties(exports, {
  Client: {
    enumerable: true,
    get: () => require('@modelcontextprotocol/sdk/client/index.js').Client,
  },
  StreamableHTTPClientTransport: {
    enumerable: true,
    get: () => require('@modelcontextprotocol/sdk/client/streamableHttp.js').StreamableHTTPClientTransport,
  },
  SSEClientTransport: {
    enumerable: true,
    get: () => require('@modelcontextprotocol/sdk/client/sse.js').SSEClientTransport,
  },
  StdioClientTransport: {
    enumerable: true,
    get: () => require('#stdio-client').StdioClientTransport,
  },
});
