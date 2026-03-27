# Configuring Transport

Configure how clients connect to your FrontMCP server — SSE, Streamable HTTP, stateless API, or a combination.

## When to Use This Skill

### Must Use

- Setting up a new FrontMCP server and need to decide on a transport protocol (SSE, Streamable HTTP, or stateless)
- Deploying to serverless targets (Vercel, Lambda, Cloudflare) that require stateless transport mode
- Running multiple server instances behind a load balancer that require distributed sessions via Redis

### Recommended

- Migrating an existing server from legacy SSE to modern Streamable HTTP
- Enabling SSE event resumability so clients can reconnect after network interruptions
- Fine-tuning protocol flags beyond what the built-in presets provide

### Skip When

- You are configuring authentication or session tokens (use `configure-auth` instead)
- You need to set up plugin middleware without changing the transport layer (use `create-plugin` reference instead)

> **Decision:** Use this skill whenever you need to choose, combine, or customize the protocol(s) your MCP server exposes to clients.

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

## Common Patterns

| Pattern              | Correct                                                                          | Incorrect                                                  | Why                                                                                |
| -------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Choosing a preset    | `protocol: 'modern'`                                                             | `protocol: { sse: true, streamable: true, legacy: false }` | Use a preset when it matches your needs; custom config is for overrides only       |
| Serverless transport | `protocol: 'stateless-api'` with `sessionMode: 'stateless'`                      | `protocol: 'legacy'` on Lambda                             | Legacy preset creates sessions that serverless cannot maintain between invocations |
| Distributed sessions | `distributedMode: true` with Redis `persistence` configured                      | `distributedMode: true` without Redis                      | Distributed mode requires Redis; omitting it causes a startup error                |
| Event store provider | `provider: 'redis'` for multi-instance, `provider: 'memory'` for single instance | `provider: 'memory'` behind a load balancer                | In-memory event store is not shared across instances, breaking SSE resumability    |
| Session TTL          | Set `defaultTtlMs` to match your expected session duration                       | Omitting `defaultTtlMs` when using Redis persistence       | Missing TTL can cause sessions to accumulate indefinitely in Redis                 |

## Verification Checklist

### Transport Protocol

- [ ] Correct preset is chosen for the deployment target (see Target-Specific Recommendations table)
- [ ] Custom protocol flags, if used, do not conflict with the selected `sessionMode`
- [ ] Legacy SSE is disabled when all clients support modern MCP protocol

### Session and Persistence

- [ ] `sessionMode` is `'stateless'` for serverless deployments
- [ ] `distributedMode` is enabled and Redis is configured for multi-instance deployments
- [ ] `defaultTtlMs` is set to a reasonable value when persistence is enabled

### Event Store

- [ ] Event store provider matches the deployment topology (memory for single, Redis for distributed)
- [ ] `maxEvents` and `ttlMs` are tuned for expected traffic volume
- [ ] Event store is disabled for stateless-api deployments

### Runtime Validation

- [ ] Server starts without transport-related errors
- [ ] SSE endpoint (`/sse`) responds with `text/event-stream` when SSE is enabled
- [ ] Streamable HTTP endpoint (`/`) accepts JSON-RPC POST requests when streamable is enabled
- [ ] Clients can reconnect and resume SSE streams when event store is enabled

## Troubleshooting

| Problem                                | Cause                                                                      | Solution                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Server rejects SSE connections         | SSE is disabled in the protocol config or preset                           | Switch to `'legacy'`, `'modern'`, or `'full'` preset, or set `sse: true` in custom config  |
| `distributedMode` startup error        | Redis persistence is not configured                                        | Add a `persistence.redis` block with valid connection details                              |
| Clients lose state after reconnect     | Event store is disabled or using in-memory provider behind a load balancer | Enable event store with `provider: 'redis'` for distributed deployments                    |
| Serverless function times out on SSE   | Using a stateful preset on a serverless target                             | Switch to `'stateless-api'` preset and set `sessionMode: 'stateless'`                      |
| Session not found after server restart | In-memory sessions do not survive restarts                                 | Enable Redis persistence with `distributedMode: true`                                      |
| Streamable HTTP returns 404            | Streamable HTTP is not enabled in the current preset                       | Use `'modern'`, `'legacy'`, or `'full'` preset, or set `streamable: true` in custom config |

## Reference

- **Docs:** [Runtime Modes and Transport Configuration](https://docs.agentfront.dev/frontmcp/deployment/runtime-modes)
- **Related skills:** `configure-auth`, `create-plugin`
