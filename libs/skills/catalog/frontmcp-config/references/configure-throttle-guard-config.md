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
  defaultAction?: 'allow' | 'deny'; // default: 'allow'
  trustProxy?: boolean; // default: false
  trustedProxyDepth?: number; // default: 1
}
```

## Partition Strategies

- **`'global'`**: Single counter shared by all clients. Protects total server capacity.
- **`'ip'`**: Separate counter per client IP. Fair per-client limiting.
- **`'session'`**: Separate counter per MCP session. Fair per-session limiting.

## Priority Order

1. IP filter (allow/deny) — checked first
2. Global rate limit — checked second
3. Global concurrency — checked third
4. Per-tool rate limit — checked per tool
5. Per-tool concurrency — checked per tool
6. Per-tool timeout — enforced during execution
