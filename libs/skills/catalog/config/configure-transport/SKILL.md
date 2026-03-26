---
name: configure-transport
description: Choose and configure transport protocols — SSE, Streamable HTTP, stateless API, or legacy. Use when deciding between transport modes, enabling distributed sessions, or configuring event stores.
tags: [transport, sse, streamable-http, stateless, protocol, session]
parameters:
  - name: preset
    description: Protocol preset (legacy, modern, stateless-api, full)
    type: string
    default: legacy
examples:
  - scenario: Use modern SSE + Streamable HTTP for production
    expected-outcome: Server accepts both SSE and streamable HTTP connections
  - scenario: Configure stateless API for serverless
    expected-outcome: No session state, pure request/response
priority: 8
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/deployment/runtime-modes
---

# Configuring Transport

Configure how clients connect to your FrontMCP server — SSE, Streamable HTTP, stateless API, or a combination.

## When to Use

Configure transport when:

- Choosing between SSE and Streamable HTTP protocols
- Deploying to serverless (needs stateless mode)
- Running multiple server instances (needs distributed sessions)
- Enabling SSE event resumability

## TransportOptionsInput

```typescript
@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  transport: {
    sessionMode: 'stateful', // 'stateful' | 'stateless'
    protocol: 'legacy', // preset or custom ProtocolConfig
    persistence: {
      // false to disable
      redis: { provider: 'redis', host: 'localhost', port: 6379 },
      defaultTtlMs: 3600000,
    },
    distributedMode: 'auto', // boolean | 'auto'
    eventStore: {
      enabled: true,
      provider: 'redis', // 'memory' | 'redis'
      maxEvents: 10000,
      ttlMs: 300000,
    },
  },
})
class Server {}
```

## Protocol Presets

Choose a preset that matches your deployment:

| Preset               | SSE | Streamable HTTP | JSON | Stateless | Legacy SSE | Strict Session |
| -------------------- | --- | --------------- | ---- | --------- | ---------- | -------------- |
| `'legacy'` (default) | Yes | Yes             | No   | No        | Yes        | Yes            |
| `'modern'`           | Yes | Yes             | No   | No        | No         | Yes            |
| `'stateless-api'`    | No  | No              | No   | Yes       | No         | No             |
| `'full'`             | Yes | Yes             | Yes  | Yes       | Yes        | No             |

### When to Use Each

- **`'legacy'`** — Default. Maximum compatibility with all MCP clients (Claude Desktop, etc.). Best for Node.js deployments.
- **`'modern'`** — Drop legacy SSE support. Use when all clients support modern MCP protocol.
- **`'stateless-api'`** — No sessions, pure request/response. Use for **Vercel**, **Lambda**, and other serverless targets.
- **`'full'`** — All protocols enabled. Use for development or when you need every transport option.

### Custom Protocol Config

Override individual protocol flags:

```typescript
transport: {
  protocol: {
    sse: true,              // SSE listener endpoint
    streamable: true,       // Streamable HTTP POST
    json: false,            // JSON-only responses (no streaming)
    stateless: false,       // Stateless HTTP (no sessions)
    legacy: false,          // Legacy SSE transport
    strictSession: true,    // Require session ID for streamable HTTP
  },
}
```

## Distributed Sessions

For multi-instance deployments (load balanced), enable persistence with Redis:

```typescript
transport: {
  distributedMode: true,
  persistence: {
    redis: { provider: 'redis', host: 'redis.internal', port: 6379 },
    defaultTtlMs: 3600000,  // 1 hour session TTL
  },
}
```

- `distributedMode: 'auto'` — auto-detect based on whether Redis is configured
- `distributedMode: true` — force distributed mode (requires Redis)
- `distributedMode: false` — single-instance mode (in-memory sessions)

## Event Store (SSE Resumability)

Enable event store so clients can resume SSE connections after disconnects:

```typescript
transport: {
  eventStore: {
    enabled: true,
    provider: 'redis',       // 'memory' for single instance, 'redis' for distributed
    maxEvents: 10000,        // max events to store
    ttlMs: 300000,           // 5 minute TTL
    redis: { provider: 'redis', host: 'localhost' },
  },
}
```

## Target-Specific Recommendations

| Target                   | Recommended Preset | Persistence | Event Store |
| ------------------------ | ------------------ | ----------- | ----------- |
| Node.js (single)         | `'legacy'`         | `false`     | Memory      |
| Node.js (multi-instance) | `'modern'`         | Redis       | Redis       |
| Vercel                   | `'stateless-api'`  | `false`     | Disabled    |
| Lambda                   | `'stateless-api'`  | `false`     | Disabled    |
| Cloudflare               | `'stateless-api'`  | `false`     | Disabled    |

## Verification

```bash
# Start server and test SSE
frontmcp dev

# Test SSE endpoint
curl -N http://localhost:3001/sse

# Test streamable HTTP
curl -X POST http://localhost:3001/ -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```
