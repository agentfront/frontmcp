# @frontmcp/protocol

The single boundary between FrontMCP and the upstream
[`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk).

[![NPM](https://img.shields.io/npm/v/@frontmcp/protocol.svg)](https://www.npmjs.com/package/@frontmcp/protocol)

> **Internal package.** It is published so the other `@frontmcp/*` packages can
> resolve it — you should not import it from application code. Import MCP types
> from [`@frontmcp/sdk`](https://www.npmjs.com/package/@frontmcp/sdk) instead,
> and use `McpClient` from `@frontmcp/testing` for a raw client in tests.

## Why it exists

`libs/protocol/src/types.ts` is the **only** file in the whole monorepo that
transitively imports `@modelcontextprotocol/sdk`. Everything else — SDK,
adapters, plugins, auth, tests — imports from `@frontmcp/protocol`.

That indirection means swapping, pinning, or dropping the upstream package is a
one-file change instead of a repo-wide refactor. The
[`@nx/dependency-checks`](https://nx.dev) lint rule enforces it: adding a direct
upstream import anywhere else fails the build.

✅ Route through the boundary:

<!-- prettier-ignore -->
```ts
import { CallToolRequestSchema, McpError, type Tool } from '@frontmcp/protocol';
```

❌ Never import the upstream package directly — that locks every call site to it:

<!-- prettier-ignore -->
```ts
import { McpError } from '@modelcontextprotocol/sdk/types.js';
```

If a type you need is not reachable from `@frontmcp/protocol`, re-export it from
`libs/protocol/src/types.ts` rather than reaching around the boundary.

## What it exports

| Area                | Contents                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Protocol types      | Requests, results, notifications, schemas, `McpError`, capabilities                      |
| Protocol 2026-07-28 | Types the upstream SDK does not ship yet — see below                                     |
| Server              | `McpServer`, `StreamableHTTPServerTransport`, `WebStandardStreamableHTTPServerTransport` |
| Client              | `Client`, `StreamableHTTPClientTransport`, `SSEClientTransport`                          |
| Transports          | stdio (Node + browser), in-memory                                                        |
| Auth types          | `AuthInfo` and friends                                                                   |

Node and browser/worker variants are selected automatically through package
[subpath imports](https://nodejs.org/api/packages.html#subpath-imports), so the
same import works in every runtime FrontMCP targets.

## Protocol 2026-07-28

The upstream SDK tops out at `2025-11-25`. Revision `2026-07-28` is therefore
defined here — `MCP_20260728_META`, `MCP_20260728_ERROR_CODES`, `CacheableResult`,
`DiscoverResult`, `InputRequiredResult`, `SubscriptionFilter`, and the rest.

Everything is **additive**: the 2025-and-earlier types are untouched, because a
FrontMCP server serves both eras on the same endpoint. When upstream catches up,
`types-20260728.ts` is the only file that has to change.

See the [protocol versions guide](https://docs.agentfront.dev/frontmcp/fundamentals/protocol-versions)
for what the revision changed and how FrontMCP selects one per request.

## License

Apache-2.0
