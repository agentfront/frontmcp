---
name: configure-throttle-guard-config
description: Complete GuardConfig interface reference for rate limiting, concurrency, and IP filtering
---

# GuardConfig Full Reference

## Complete Configuration

```typescript
interface GuardConfig {
  enabled: boolean;

  // Storage for distributed rate limiting -- a StorageConfig from @frontmcp/utils,
  // NOT the top-level `redis` shape (a block without `type` is auto-detected
  // from REDIS_URL / REDIS_HOST and otherwise runs in memory)
  storage?: {
    type?: 'memory' | 'redis' | 'vercel-kv' | 'upstash' | 'auto';
    redis?:
      | { config: { host: string; port?: number; password?: string; db?: number; tls?: boolean } }
      | { url: string };
    vercelKv?: { url?: string; token?: string };
    upstash?: { url?: string; token?: string };
    // What to do when the backend is unreachable at startup:
    // 'error' (default in production) -- startup fails with GuardStorageUnavailableError (rate limits fail closed)
    // 'memory' (default otherwise)   -- start with per-instance counters
    fallback?: 'error' | 'memory';
  };

  keyPrefix?: string; // default: 'mcp:guard:' -- a trailing ':' is dropped, keys read 'mcp:guard:<entity>:...'

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

## Storage Failure and Key Format

- **Fails closed.** When `storage` cannot be reached at startup, the server does not start: startup rejects with `GuardStorageUnavailableError` (code `GUARD_STORAGE_UNAVAILABLE`), whose message names `throttle.storage`. That is the default in production. Set `storage.fallback: 'memory'` to start with per-instance counters instead. (The top-level `redis` and `transport.persistence` differ: they fall back to memory with an error log.)
- **Keys.** `<keyPrefix><entity>:<partition>:<kind>:...`, e.g. `mcp:guard:export_tickets:global:rl:1790722980000`. Before 1.8.6 the default prefix wrote `mcp:guard::export_tickets:...`; old and new instances do not read each other's counters, so limits briefly split during a rolling deploy. A custom `keyPrefix` without a trailing `:` keeps its keys.

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
