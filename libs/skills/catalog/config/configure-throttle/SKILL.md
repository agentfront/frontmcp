---
name: configure-throttle
description: Set up rate limiting, concurrency control, timeouts, and IP filtering at server and per-tool level. Use when protecting against abuse, limiting request rates, or configuring IP allow/deny lists.
tags: [throttle, rate-limit, concurrency, timeout, security, guard, ip-filter]
parameters:
  - name: maxRequests
    description: Maximum requests per window
    type: number
    default: 100
examples:
  - scenario: Rate limit all tools to 100 requests per minute
    expected-outcome: Requests beyond limit receive 429 response
  - scenario: Limit concurrent executions of expensive tool to 5
    expected-outcome: 6th concurrent call queues or fails
  - scenario: Block requests from specific IP ranges
    expected-outcome: Blocked IPs receive 403 response
priority: 7
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/servers/guard
---

# Configuring Throttle, Rate Limits, and IP Filtering

Protect your FrontMCP server with rate limiting, concurrency control, execution timeouts, and IP filtering — at both server and per-tool levels.

## When to Use

Configure throttle when:

- Protecting against abuse or DDoS
- Limiting expensive tool executions
- Enforcing per-session or per-IP request quotas
- Blocking or allowing specific IP ranges
- Setting execution timeouts for long-running tools

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
    redis: { provider: 'redis', host: 'redis.internal' },
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
