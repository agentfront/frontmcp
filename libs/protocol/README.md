# @frontmcp/protocol

FrontMCP's single point of contact with the upstream [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk): it re-exports the MCP protocol types, server, client and transports that the other `@frontmcp/*` packages use. The client and its transports come from the `@frontmcp/protocol/client` subpath, so a server, or a browser or Worker bundle of one, doesn't load them. This is an internal package, published only so those packages can depend on it. Don't import it from application code: import MCP types from [`@frontmcp/sdk`](https://www.npmjs.com/package/@frontmcp/sdk), and use `McpClient` from [`@frontmcp/testing`](https://www.npmjs.com/package/@frontmcp/testing) when a test needs a raw client.

[![npm](https://img.shields.io/npm/v/@frontmcp/protocol.svg)](https://www.npmjs.com/package/@frontmcp/protocol) [![License](https://img.shields.io/npm/l/@frontmcp/protocol.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Install

You don't install it yourself: `@frontmcp/sdk` depends on it. It needs Node.js 24 or later.

## What it exports

| Area                                 | Contents                                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Protocol types                       | Everything in `@modelcontextprotocol/sdk/types.js`: requests, results, notifications, schemas, `McpError`        |
| Protocol 2026-07-28                  | `MCP_20260728_META`, `MCP_20260728_ERROR_CODES`, `CacheableResult`, `DiscoverResult`, `InputRequiredResult`, …   |
| Server                               | `McpServer`, `StreamableHTTPServerTransport`, `WebStandardStreamableHTTPServerTransport`, `StdioServerTransport` |
| Client (`@frontmcp/protocol/client`) | `Client`, `StreamableHTTPClientTransport`, `SSEClientTransport`, `StdioClientTransport`                          |
| Other                                | `InMemoryTransport`, `Transport`, `RequestHandlerExtra`, `AuthInfo`                                              |

The browser build swaps in browser versions of the server and Streamable HTTP modules through the package's `imports` map. The stdio transports need Node.js: in a browser or worker build they throw when constructed.

## Protocol 2026-07-28

`@modelcontextprotocol/sdk` 1.29 supports protocol revisions up to `2025-11-25`, so the types of revision `2026-07-28` are defined here. They only add to the earlier types, because a FrontMCP server serves both revisions on the same endpoint. See [Protocol versions](https://frontmcp.dev/reference/server/protocol-versions) for what the revision changed and how FrontMCP picks one per request.

## Contributing

Source: [`libs/protocol`](https://github.com/agentfront/frontmcp/tree/main/libs/protocol). Issues and pull requests are welcome; see [CONTRIBUTING.md](https://github.com/agentfront/frontmcp/blob/main/CONTRIBUTING.md).

Inside the monorepo, this is the only package that imports `@modelcontextprotocol/sdk`. Import MCP types from `@frontmcp/protocol` instead of the upstream package, and when a type you need is missing, re-export it from [`src/types.ts`](https://github.com/agentfront/frontmcp/blob/main/libs/protocol/src/types.ts) (or [`src/types-20260728.ts`](https://github.com/agentfront/frontmcp/blob/main/libs/protocol/src/types-20260728.ts) for the newer revision). That way, upgrading or replacing the upstream package touches only this package.

## License

Apache-2.0. See [LICENSE](https://github.com/agentfront/frontmcp/blob/main/LICENSE).
