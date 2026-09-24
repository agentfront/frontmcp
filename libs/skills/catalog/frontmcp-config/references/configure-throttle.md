---
name: configure-throttle
description: Protect servers with rate limiting, concurrency control, execution timeouts, and IP filtering
---

# Configuring Throttle, Rate Limits, and IP Filtering

Protect your FrontMCP server with rate limiting, concurrency control, execution timeouts, and IP filtering — at both server and per-tool levels.

## When to Use This Skill

### Must Use

- Deploying a server to production where abuse protection and rate limiting are required
- Exposing expensive or destructive tools that need concurrency caps and execution timeouts
- Restricting access by IP address with allow/deny lists for compliance or security

### Recommended

- Enforcing per-session or per-IP request quotas to ensure fair resource distribution
- Adding global concurrency limits to prevent server overload under burst traffic
- Configuring distributed rate limiting across multiple server instances with Redis

### Skip When

- Running a local development server with stdio transport only -- throttle adds unnecessary overhead
- Only need CORS or port configuration without rate limiting -- use `configure-http`
- Need authentication or session management rather than rate limiting -- use `configure-session` or `configure-auth`

> **Decision:** Use this skill when your server needs protection against abuse, rate limiting, concurrency control, IP filtering, or execution timeouts at either the server or per-tool level.

## Server-Level Throttle (GuardConfig)

```typescript
@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  throttle: {
    enabled: true,

    // Global rate limit (all requests combined)
    global: {
      maxRequests: 1000,
      windowMs: 60000, // 1 minute window
      partitionBy: 'global', // shared across all clients
    },

    // Global concurrency limit
    globalConcurrency: {
      maxConcurrent: 50,
      partitionBy: 'global',
    },

    // Default limits for individual tools (applied unless tool overrides)
    defaultRateLimit: {
      maxRequests: 100,
      windowMs: 60000,
    },
    defaultConcurrency: {
      maxConcurrent: 10,
    },
    defaultTimeout: {
      executeMs: 30000, // 30 second timeout
    },

    // IP filtering
    ipFilter: {
      allowList: ['10.0.0.0/8', '172.16.0.0/12'], // CIDR ranges
      denyList: ['192.168.1.100'],
      defaultAction: 'allow', // 'allow' | 'deny'
      // NOTE: trustProxy / trustedProxyDepth are NOT read here -- use the
      // FRONTMCP_TRUST_PROXY and FRONTMCP_TRUSTED_PROXY_DEPTH environment variables.
    },
  },
})
class Server {}
```

## Per-Tool Rate Limiting

Override server defaults on individual tools:

```typescript
@Tool({
  name: 'expensive_query',
  description: 'Run an expensive database query',
  inputSchema: {
    query: z.string(),
  },
  outputSchema: { rows: z.array(z.record(z.unknown())) },

  // Per-tool limits
  rateLimit: {
    maxRequests: 10,
    windowMs: 60000,
    partitionBy: 'session', // per-session rate limit
  },
  concurrency: {
    maxConcurrent: 3,
    queueTimeoutMs: 5000, // wait up to 5s for a slot
    partitionBy: 'session',
  },
  timeout: {
    executeMs: 60000, // 60 second timeout for this tool
  },
})
class ExpensiveQueryTool extends ToolContext {
  async execute(input: { query: string }) {
    const db = this.get(DB_TOKEN);
    return { rows: await db.query(input.query) };
  }
}
```

## `ipFilter` is enforced on every request

`allowList`, `denyList` and `defaultAction` are checked at the start of the request pipeline,
before the rate-limit check and before authentication. A rejected client gets HTTP 403 with
JSON-RPC error `-32001`.

An `ipFilter` block works on its own -- you do not need to configure a `global` rate limit
alongside it for the filter to run.

## `partitionBy: 'ip'` needs a declared trusted proxy

The client IP comes from the socket peer address. `X-Forwarded-For` and `X-Real-IP` are set
by whoever sent the request, so they are ignored unless you declare a trusted proxy:

```bash
FRONTMCP_TRUST_PROXY=true          # honour forwarded headers -- ONLY behind a real proxy
FRONTMCP_TRUSTED_PROXY_DEPTH=1     # how many proxies you run in front of the app
```

- Behind a load balancer **without** `FRONTMCP_TRUST_PROXY`, every request looks like it came
  from the balancer and all clients share one bucket.
- **With** it but no proxy actually in front, a caller forges the header and gets a fresh
  bucket per request, so the limit never triggers.

The client is read `FRONTMCP_TRUSTED_PROXY_DEPTH` hops back from the end of the chain: callers
can prepend entries, but only your own proxies append to it. The value is validated as an IP
address before use. A chain shorter than the configured depth was not built by your proxies,
so the socket peer is used instead.

> **`FRONTMCP_TRUST_PROXY` is only as good as your network boundary.** Trusting forwarded
> headers means trusting whoever can set them, so two things must hold:
>
> - **Every ingress path traverses the configured proxy chain.** If a caller can reach the
>   origin directly -- a public origin IP, a peered VPC, a second ingress that skips the
>   balancer -- they choose the whole `X-Forwarded-For` chain, and counting hops from its end
>   just lands on an address they picked.
> - **The edge strips and rebuilds the forwarded headers.** The outermost proxy must discard
>   any inbound `X-Forwarded-For` and `X-Real-IP` and write its own, so the only entries in
>   the chain are ones your proxies appended.
>
> With depth `1` and no `X-Forwarded-For` at all, `X-Real-IP` is used -- the single-hop nginx
> convention. It is never consulted alongside a chain, because a caller can send both.

When no IP can be established the request falls back to the authenticated user
(`user:<userId>`), and to a single `ip:unresolved` partition when there is no user either. It
never keys on the session id: `mcp-session-id` is caller-supplied and a request without one is
given a fresh UUID, so keying on it would mint a new budget per request. The shared bucket is
contended by design -- bounded contention beats an unbounded budget -- and declaring your proxy
is what takes callers out of it.

## Configuration Types

### RateLimitConfig

| Field         | Type                            | Default    | Description               |
| ------------- | ------------------------------- | ---------- | ------------------------- |
| `maxRequests` | `number`                        | —          | Max requests per window   |
| `windowMs`    | `number`                        | `60000`    | Window duration in ms     |
| `partitionBy` | `'global' \| 'ip' \| 'session'` | `'global'` | How to partition counters |

### ConcurrencyConfig

| Field            | Type                            | Default    | Description                                        |
| ---------------- | ------------------------------- | ---------- | -------------------------------------------------- |
| `maxConcurrent`  | `number`                        | —          | Max simultaneous executions                        |
| `queueTimeoutMs` | `number`                        | `0`        | How long to wait for a slot (0 = fail immediately) |
| `partitionBy`    | `'global' \| 'ip' \| 'session'` | `'global'` | How to partition counters                          |

### TimeoutConfig

| Field       | Type     | Default | Description              |
| ----------- | -------- | ------- | ------------------------ |
| `executeMs` | `number` | —       | Max execution time in ms |

### IpFilterConfig

| Field               | Type                | Default   | Description                                      |
| ------------------- | ------------------- | --------- | ------------------------------------------------ |
| `allowList`         | `string[]`          | —         | Allowed IPs or CIDR ranges                       |
| `denyList`          | `string[]`          | —         | Blocked IPs or CIDR ranges                       |
| `defaultAction`     | `'allow' \| 'deny'` | `'allow'` | Action when IP matches neither list              |
| `trustProxy`        | `boolean`           | `false`   | **Not read.** Use `FRONTMCP_TRUST_PROXY`         |
| `trustedProxyDepth` | `number`            | `1`       | **Not read.** Use `FRONTMCP_TRUSTED_PROXY_DEPTH` |

## Partition Strategies

- **`'global'`** — Single shared counter for all clients. Use for global capacity limits.
- **`'ip'`** — Separate counter per client IP. Use for per-client rate limiting.
- **`'session'`** — Separate counter per MCP session. Use for per-session fairness. A request with no session (every MCP 2026-07-28 request, and stateless HTTP) falls back to the signed-in user; anonymous callers share one `anonymous` counter.
- **`'userId'`** — Separate counter per signed-in user. Anonymous callers fall back to the session, as above.

## Distributed Rate Limiting

For multi-instance deployments, configure Redis storage in the guard:

```typescript
throttle: {
  enabled: true,
  storage: {
    type: 'redis',
    redis: { config: { host: 'redis.internal', port: 6379 } },
  },
  global: { maxRequests: 1000, windowMs: 60000 },
}
```

## Verification

```bash
# Start server
frontmcp dev

# Test rate limiting (send 101 requests rapidly)
for i in $(seq 1 101); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/ \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
done
# Should see 429 responses after limit is exceeded
```

## Common Patterns

| Pattern                   | Correct                                                                                                                        | Incorrect                                                            | Why                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Per-tool override         | Set `rateLimit` on the `@Tool` decorator to override server defaults                                                           | Duplicating the full server-level `throttle` config inside each tool | Per-tool config merges with server defaults; only specify the fields you want to override                                          |
| Partition strategy        | Use `partitionBy: 'session'` for per-user fairness on shared tools                                                             | Using `partitionBy: 'global'` for all limits                         | Global partitioning means one abusive client can exhaust the quota for everyone                                                    |
| Distributed rate limiting | Configure `storage: { type: 'redis', redis: { config: { host, port } } }` in the throttle block for multi-instance deployments | Relying on in-memory counters with multiple server instances         | In-memory counters are per-process; each instance tracks limits independently, allowing N times the intended rate                  |
| IP filter ordering        | Set `defaultAction: 'deny'` with an explicit `allowList` for strict environments                                               | Setting `defaultAction: 'allow'` with only a `denyList`              | A deny-by-default posture is safer; new unknown IPs are blocked until explicitly allowed                                           |
| Concurrency queue timeout | Set `queueTimeoutMs` on concurrency config to queue excess requests briefly                                                    | Setting `queueTimeoutMs: 0` on expensive tools                       | Zero timeout immediately rejects excess requests instead of briefly queuing them, causing unnecessary failures during short bursts |

## Verification Checklist

### Configuration

- [ ] `throttle.enabled` is set to `true` in the `@FrontMcp` decorator for the server-level options (`global`, `globalConcurrency`, the `default*` settings, `ipFilter`). A tool's own `rateLimit`/`concurrency` apply without it; `throttle.enabled: false` turns every guard off
- [ ] `global.maxRequests` and `global.windowMs` are set to reasonable production values
- [ ] `defaultTimeout.executeMs` is configured to prevent runaway tool executions
- [ ] IP filter `defaultAction` matches your security posture (`allow` for open, `deny` for restricted)

### Per-Tool

- [ ] Expensive or destructive tools have explicit `rateLimit` and `concurrency` overrides
- [ ] `partitionBy` is set to `'session'` or `'ip'` for tools that need per-client fairness
- [ ] `queueTimeoutMs` is set on concurrency-limited tools to handle brief bursts

### Distributed

- [ ] Redis storage is configured in the throttle block for multi-instance deployments
- [ ] Redis connection is verified before deploying (see `setup-redis`)

### Runtime

- [ ] Sending requests beyond the rate limit returns HTTP 429
- [ ] Blocked IPs receive HTTP 403
- [ ] Tool executions that exceed `executeMs` return an `EXECUTION_TIMEOUT` error and abort `this.signal`; the tool passes `this.signal` to `fetch` and other cancellable work so it stops too

## Troubleshooting

| Problem                                         | Cause                                                                                                                                                                                                     | Solution                                                                                             |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Rate limits not enforced across instances       | In-memory storage used with multiple server replicas                                                                                                                                                      | Configure `storage: { type: 'redis' }` in the throttle block to share counters                       |
| All requests rejected with 403                  | `ipFilter.defaultAction` set to `'deny'` without any `allowList` entries                                                                                                                                  | Add the allowed IP ranges to `allowList` or change `defaultAction` to `'allow'`                      |
| Tools timing out unexpectedly                   | `defaultTimeout.executeMs` too low for the tool's normal execution time                                                                                                                                   | Increase the global default or set a per-tool `timeout.executeMs` override                           |
| `X-Forwarded-For` header ignored                | No trusted proxy declared. `ipFilter.trustProxy` / `trustedProxyDepth` are accepted by the schema but NOT read -- client-IP extraction happens in the SDK context layer, before guard config is reachable | Set the `FRONTMCP_TRUST_PROXY=true` and `FRONTMCP_TRUSTED_PROXY_DEPTH` environment variables instead |
| Rate limit resets not aligned with expectations | `windowMs` misunderstood as a sliding window when it is a fixed window                                                                                                                                    | The window is fixed; all counters reset at the end of each `windowMs` interval                       |

## Examples

| Example                                                                                      | Level        | Description                                                                                 |
| -------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------- |
| [`distributed-redis-throttle`](../examples/configure-throttle/distributed-redis-throttle.md) | Advanced     | Configure Redis-backed rate limiting for multi-instance deployments behind a load balancer. |
| [`per-tool-rate-limit`](../examples/configure-throttle/per-tool-rate-limit.md)               | Intermediate | Override server defaults with per-tool rate limits and concurrency caps.                    |
| [`server-level-rate-limit`](../examples/configure-throttle/server-level-rate-limit.md)       | Basic        | Configure global rate limits and IP filtering at the server level.                          |

> See all examples in [`examples/configure-throttle/`](../examples/configure-throttle/)

## Reference

- [Guard Configuration Docs](https://docs.agentfront.dev/frontmcp/servers/guard)
- Related skills: `configure-http`, `configure-transport`, `setup-redis`, `configure-auth`
