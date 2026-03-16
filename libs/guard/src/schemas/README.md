# schemas

Zod validation schemas for all `@frontmcp/guard` configuration objects. These schemas are used to validate configuration at the boundary (e.g., when parsing user-supplied config) and provide defaults for optional fields.

## Exported Schemas

| Schema                    | Validates                                                                                     | Key Defaults                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `partitionKeySchema`      | `PartitionKey` -- a union of `'ip' \| 'session' \| 'userId' \| 'global'` or a custom function | --                                                                    |
| `rateLimitConfigSchema`   | `RateLimitConfig`                                                                             | `windowMs: 60000`, `partitionBy: 'global'`                            |
| `concurrencyConfigSchema` | `ConcurrencyConfig`                                                                           | `queueTimeoutMs: 0`, `partitionBy: 'global'`                          |
| `timeoutConfigSchema`     | `TimeoutConfig`                                                                               | --                                                                    |
| `ipFilterConfigSchema`    | `IpFilterConfig`                                                                              | `defaultAction: 'allow'`, `trustProxy: false`, `trustedProxyDepth: 1` |
| `guardConfigSchema`       | `GuardConfig` (top-level)                                                                     | `keyPrefix: 'mcp:guard:'`                                             |

## Peer Dependency

Requires `zod` (peer, `^4.0.0`).
