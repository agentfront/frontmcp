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
      trustProxy: true, // trust X-Forwarded-For
      trustedProxyDepth: 1, // proxy depth to trust
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

| Field               | Type                | Default   | Description                         |
| ------------------- | ------------------- | --------- | ----------------------------------- |
| `allowList`         | `string[]`          | —         | Allowed IPs or CIDR ranges          |
| `denyList`          | `string[]`          | —         | Blocked IPs or CIDR ranges          |
| `defaultAction`     | `'allow' \| 'deny'` | `'allow'` | Action when IP matches neither list |
| `trustProxy`        | `boolean`           | `false`   | Trust X-Forwarded-For header        |
| `trustedProxyDepth` | `number`            | `1`       | How many proxy hops to trust        |

## Partition Strategies

- **`'global'`** — Single shared counter for all clients. Use for global capacity limits.
- **`'ip'`** — Separate counter per client IP. Use for per-client rate limiting.
- **`'session'`** — Separate counter per MCP session. Use for per-session fairness.

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
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/ \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
done
# Should see 429 responses after limit is exceeded
```

## Common Patterns

| Pattern                   | Correct                                                                                     | Incorrect                                                            | Why                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Per-tool override         | Set `rateLimit` on the `@Tool` decorator to override server defaults                        | Duplicating the full server-level `throttle` config inside each tool | Per-tool config merges with server defaults; only specify the fields you want to override                                          |
| Partition strategy        | Use `partitionBy: 'session'` for per-user fairness on shared tools                          | Using `partitionBy: 'global'` for all limits                         | Global partitioning means one abusive client can exhaust the quota for everyone                                                    |
| Distributed rate limiting | Configure `storage: { type: 'redis' }` in the throttle block for multi-instance deployments | Relying on in-memory counters with multiple server instances         | In-memory counters are per-process; each instance tracks limits independently, allowing N times the intended rate                  |
| IP filter ordering        | Set `defaultAction: 'deny'` with an explicit `allowList` for strict environments            | Setting `defaultAction: 'allow'` with only a `denyList`              | A deny-by-default posture is safer; new unknown IPs are blocked until explicitly allowed                                           |
| Concurrency queue timeout | Set `queueTimeoutMs` on concurrency config to queue excess requests briefly                 | Setting `queueTimeoutMs: 0` on expensive tools                       | Zero timeout immediately rejects excess requests instead of briefly queuing them, causing unnecessary failures during short bursts |

## Verification Checklist

### Configuration

- [ ] `throttle.enabled` is set to `true` in the `@FrontMcp` decorator
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
- [ ] Tool executions that exceed `executeMs` are terminated and return a timeout error

## Troubleshooting

| Problem                                         | Cause                                                                    | Solution                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Rate limits not enforced across instances       | In-memory storage used with multiple server replicas                     | Configure `storage: { type: 'redis' }` in the throttle block to share counters  |
| All requests rejected with 403                  | `ipFilter.defaultAction` set to `'deny'` without any `allowList` entries | Add the allowed IP ranges to `allowList` or change `defaultAction` to `'allow'` |
| Tools timing out unexpectedly                   | `defaultTimeout.executeMs` too low for the tool's normal execution time  | Increase the global default or set a per-tool `timeout.executeMs` override      |
| `X-Forwarded-For` header ignored                | `ipFilter.trustProxy` not enabled or `trustedProxyDepth` too low         | Set `trustProxy: true` and adjust `trustedProxyDepth` to match your proxy chain |
| Rate limit resets not aligned with expectations | `windowMs` misunderstood as a sliding window when it is a fixed window   | The window is fixed; all counters reset at the end of each `windowMs` interval  |

## Reference

- [Guard Configuration Docs](https://docs.agentfront.dev/frontmcp/servers/guard)
- Related skills: `configure-http`, `configure-transport`, `setup-redis`, `configure-auth`
