---
name: configure-throttle-guard-config
description: Complete GuardConfig interface reference for rate limiting, concurrency, and IP filtering
---

# GuardConfig Full Reference

## Complete Configuration

```typescript
interface GuardConfig {
  enabled: boolean;

  // Storage for distributed rate limiting
  storage?: {
    type: 'memory' | 'redis';
    redis?: RedisOptionsInput;
  };

  keyPrefix?: string; // default: 'mcp:guard:'

  // Server-wide limits
  global?: RateLimitConfig;
  globalConcurrency?: ConcurrencyConfig;

  // Default per-tool limits (overridden by tool-level config)
  defaultRateLimit?: RateLimitConfig;
  defaultConcurrency?: ConcurrencyConfig;
  defaultTimeout?: TimeoutConfig;

  // IP-based access control
  ipFilter?: IpFilterConfig;
}

interface RateLimitConfig {
  maxRequests: number;
  windowMs?: number; // default: 60000 (1 minute)
  partitionBy?: 'global' | 'ip' | 'session'; // default: 'global'
}

interface ConcurrencyConfig {
  maxConcurrent: number;
  queueTimeoutMs?: number; // default: 0 (fail immediately)
  partitionBy?: 'global' | 'ip' | 'session';
}

interface TimeoutConfig {
  executeMs: number;
}

interface IpFilterConfig {
  allowList?: string[]; // IP addresses or CIDR ranges
  denyList?: string[];
  defaultAction?: 'allow' | 'deny'; // default: 'allow'; also applies when no client IP is known
  trustProxy?: boolean; // NOT read (startup warning) -- set FRONTMCP_TRUST_PROXY
  trustedProxyDepth?: number; // NOT read (startup warning) -- set FRONTMCP_TRUSTED_PROXY_DEPTH
}
```

## Partition Strategies

- **`'global'`**: Single counter shared by all clients. Protects total server capacity.
- **`'ip'`**: Separate counter per client IP. Fair per-client limiting.
- **`'session'`**: Separate counter per MCP session the server verified; a `mcp-session-id` it does not accept is ignored. Fair per-session limiting. A request without a verified session (every MCP 2026-07-28 request, or a rejected session id) falls back to the signed-in user; anonymous callers share one `anonymous` counter.

## Priority Order

1. IP filter (allow/deny) — checked first, on every HTTP route except health probes and `/metrics`
2. Global rate limit — checked second
3. Global concurrency — checked third
4. Per-tool rate limit — checked per tool
5. Per-tool concurrency — checked per tool
6. Per-tool timeout — enforced during execution

## Examples

| Example                                                                                       | Level    | Description                                                              |
| --------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------ |
| [`full-guard-config`](../examples/configure-throttle-guard-config/full-guard-config.md)       | Advanced | Complete GuardConfig using every available field for maximum protection. |
| [`minimal-guard-config`](../examples/configure-throttle-guard-config/minimal-guard-config.md) | Basic    | Enable throttle with just a global rate limit and default timeout.       |

> See all examples in [`examples/configure-throttle-guard-config/`](../examples/configure-throttle-guard-config/)
