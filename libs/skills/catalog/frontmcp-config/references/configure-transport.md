---
name: configure-transport
description: Configure client transport protocols including SSE, Streamable HTTP, and stateless API modes
---

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
    protocol: 'legacy', // preset or custom ProtocolConfig
    persistence: {
      // false to disable
      redis: { provider: 'redis', host: 'localhost', port: 6379 },
      defaultTtlMs: 3600000,
    },
    distributedMode: 'auto', // boolean | 'auto'
    eventStore: {
      enabled: true,
      provider: 'redis', // 'memory' | 'redis' | 'sqlite'
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
    sessionCheckTimeoutMs: 500, // default; how long a request waits for the store to confirm a session held in memory
  },
}
```

- `sessionCheckTimeoutMs` (default `500`) bounds the per-request check an instance makes before it serves a session it holds in memory (the stored record still exists; in distributed mode, after a heartbeat gap, this node still owns it). A store that accepts the connection but doesn't answer (paused Redis, network partition) no longer holds the request open: the session is served from memory, `Could not confirm the session is still stored — serving it here` is logged with `The session store did not answer within 500 ms`, and the next request checks again

- `distributedMode: 'auto'` — auto-detect based on whether Redis is configured
- `distributedMode: true` — force distributed mode (requires Redis)
- `distributedMode: false` — single-instance mode (in-memory sessions)
- `providerCaching` — keep `CONTEXT`-scoped provider instances for a verified session across its requests (default `true`, `false` in distributed mode); `false` builds them once per request. It applies to the providers of the server and of every app, plugin and agent

## Event Store (SSE Resumability)

Enable event store so clients can resume SSE connections after disconnects:

```typescript
transport: {
  eventStore: {
    enabled: true,
    provider: 'redis',       // 'memory' | 'redis' | 'sqlite'
    maxEvents: 10000,        // max events to store
    ttlMs: 300000,           // 5 minute TTL
    redis: { provider: 'redis', host: 'localhost' },
  },
}
```

**Auto-enabled in distributed mode.** A distributed deployment with Redis configured turns the event store on without an explicit `eventStore` block, so the notes below apply there too.

**Requires 1.7.2 or later.** Before 1.7.2 (GHSA-84j6-jc92-77jm) one store instance was shared by every session with no ownership check on replay, and the upstream transport writes every session's standalone SSE stream under the constant id `_GET_stream` with sequential event numbers — so a client sending `Last-Event-ID: _GET_stream:1` was replayed other sessions' server-to-client messages (tool results, resource contents, notifications). On 1.7.1 or earlier, do not enable the event store on a multi-tenant deployment.

From 1.7.2 each session gets a view over the shared store scoped to its own session id: an event id belonging to another session replays nothing.

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
curl -N http://localhost:3000/sse

# Test streamable HTTP
curl -X POST http://localhost:3000/ -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

## Common Patterns

| Pattern              | Correct                                                                          | Incorrect                                                  | Why                                                                                |
| -------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Choosing a preset    | `protocol: 'modern'`                                                             | `protocol: { sse: true, streamable: true, legacy: false }` | Use a preset when it matches your needs; custom config is for overrides only       |
| Serverless transport | `protocol: 'stateless-api'`                                                      | `protocol: 'legacy'` on Lambda                             | Legacy preset creates sessions that serverless cannot maintain between invocations |
| Distributed sessions | `distributedMode: true` with Redis `persistence` configured                      | `distributedMode: true` without Redis                      | Distributed mode requires Redis; omitting it causes a startup error                |
| Event store provider | `provider: 'redis'` for multi-instance, `provider: 'memory'` for single instance | `provider: 'memory'` behind a load balancer                | In-memory event store is not shared across instances, breaking SSE resumability    |
| Session TTL          | Set `defaultTtlMs` to match your expected session duration                       | Omitting `defaultTtlMs` when using Redis persistence       | Missing TTL can cause sessions to accumulate indefinitely in Redis                 |

## Verification Checklist

### Transport Protocol

- [ ] Correct preset is chosen for the deployment target (see Target-Specific Recommendations table)
- [ ] Custom protocol flags, if used, match whether the server should keep sessions (`stateless: true` serves without them)
- [ ] Legacy SSE is disabled when all clients support modern MCP protocol

### Session and Persistence

- [ ] `protocol` is `'stateless-api'` for serverless deployments (sessions follow `protocol`; the deprecated `sessionMode` is ignored, logs a startup warning when set to anything but `'stateful'`, and is removed in the next major)
- [ ] No `transport.sessionMode` or top-level `session` left in the config — migrate `sessionMode: 'stateless'` to `protocol: 'stateless-api'` and `session.platformDetection` to `transport.platformDetection`
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

| Problem                                                                                                                                               | Cause                                                                                       | Solution                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server rejects SSE connections                                                                                                                        | SSE is disabled in the protocol config or preset                                            | Switch to `'legacy'`, `'modern'`, or `'full'` preset, or set `sse: true` in custom config                                                                                                                             |
| `distributedMode` startup error                                                                                                                       | Redis persistence is not configured                                                         | Add a `persistence.redis` block with valid connection details                                                                                                                                                         |
| Clients lose state after reconnect                                                                                                                    | Event store is disabled or using in-memory provider behind a load balancer                  | Enable event store with `provider: 'redis'` for distributed deployments                                                                                                                                               |
| Serverless function times out on SSE                                                                                                                  | Using a stateful preset on a serverless target                                              | Switch to the `'stateless-api'` preset                                                                                                                                                                                |
| Session not found after server restart                                                                                                                | In-memory sessions do not survive restarts                                                  | Enable Redis persistence with `distributedMode: true`                                                                                                                                                                 |
| Streamable HTTP returns 404                                                                                                                           | Streamable HTTP is not enabled in the current preset                                        | Use `'modern'`, `'legacy'`, or `'full'` preset, or set `streamable: true` in custom config                                                                                                                            |
| Startup warning `transport.sessionMode ... is ignored and will be removed in the next major` (or `session.sessionMode` / `session.platformDetection`) | The deprecated session options are set; nothing reads them, and the next major removes them | `sessionMode: 'stateless'` → `protocol: 'stateless-api'`; drop `sessionMode: 'stateful'`; `session.platformDetection` → `transport.platformDetection`. Provider tokens always stay server-side in `auth.tokenStorage` |

## Examples

| Example                                                                                       | Level        | Description                                                                              |
| --------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------- |
| [`custom-protocol-flags`](../examples/configure-transport/custom-protocol-flags.md)           | Advanced     | Override individual protocol flags instead of using a preset for fine-grained control.   |
| [`distributed-sessions-redis`](../examples/configure-transport/distributed-sessions-redis.md) | Intermediate | Configure transport with Redis persistence for multi-instance load-balanced deployments. |
| [`stateless-serverless`](../examples/configure-transport/stateless-serverless.md)             | Basic        | Configure stateless transport for Vercel, Lambda, or Cloudflare deployments.             |

> See all examples in [`examples/configure-transport/`](../examples/configure-transport/)

## Reference

- **Docs:** [Runtime Modes and Transport Configuration](https://frontmcp.dev/learn/running-frontmcp-anywhere)
- **Related skills:** `configure-auth`, `create-plugin`
