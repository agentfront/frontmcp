/**
 * Jest moduleNameMapper entries for resolving #imports (package.json "imports" field).
 *
 * Jest does not natively support Node.js conditional #imports, so we resolve
 * them explicitly to the "default" (Node) condition. Spread these into any
 * jest config that defines its own moduleNameMapper (which overrides the preset).
 */
const path = require('path');

const root = __dirname;

module.exports = {
  // @frontmcp/utils conditionals
  '^#crypto-provider$': path.resolve(root, 'libs/utils/src/crypto/node.ts'),
  '^#async-context$': path.resolve(root, 'libs/utils/src/async-context/node-async-context.ts'),
  '^#event-emitter$': path.resolve(root, 'libs/utils/src/event-emitter/node-event-emitter.ts'),
  '^#env$': path.resolve(root, 'libs/utils/src/env/node-env.ts'),
  '^#path$': path.resolve(root, 'libs/utils/src/path/node-path.ts'),

  // @frontmcp/protocol MCP conditionals
  '^#mcp-streamable-http$': path.resolve(root, 'libs/protocol/src/node-mcp-streamable-http.ts'),
  '^#mcp-server$': path.resolve(root, 'libs/protocol/src/node-mcp-server.ts'),
  '^#server-types$': path.resolve(root, 'libs/protocol/src/node-server-types.ts'),

  // @frontmcp/sdk conditionals
  '^#sse-transport$': path.resolve(root, 'libs/sdk/src/transport/adapters/polyfills/node-sse-transport.ts'),
  '^#express-host$': path.resolve(root, 'libs/sdk/src/server/adapters/polyfills/node-express-host.ts'),
};
