// The `require` variant of `#mcp-streamable-http`: each transport loads its MCP SDK module (and @hono/node-server) the first time it is read.
Object.defineProperties(exports, {
  StreamableHTTPServerTransport: {
    enumerable: true,
    get: () => require('@modelcontextprotocol/sdk/server/streamableHttp.js').StreamableHTTPServerTransport,
  },
  WebStandardStreamableHTTPServerTransport: {
    enumerable: true,
    get: () =>
      require('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js').WebStandardStreamableHTTPServerTransport,
  },
});
