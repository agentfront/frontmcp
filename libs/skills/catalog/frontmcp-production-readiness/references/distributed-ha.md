---
name: distributed-ha
description: Deploy FrontMCP across multiple pods with heartbeat, session takeover, and notification relay for zero-downtime failover
---

# Distributed High Availability

FrontMCP's HA module provides automatic session failover across multiple pods using Redis. Three components work together: HeartbeatService (liveness detection), session takeover (atomic CAS), and NotificationRelay (cross-pod MCP notifications).

## When to Use This Skill

### Must Use

- Running 2+ FrontMCP pods behind a load balancer with Redis available
- Production deployments where pod restarts must not drop active MCP sessions
- Kubernetes deployments with rolling updates or horizontal pod autoscaling

### Recommended

- Any production deployment where zero-downtime upgrades are needed
- Multi-region setups with Redis replication

### Skip When

- Single-pod deployments (use `deploy-to-node` instead)
- Serverless platforms (Vercel, Lambda, Cloudflare) --- stateless by design
- Development and testing --- use `direct-client` or standalone mode

> **Decision:** Use this skill when you need session continuity across pod restarts. Skip for serverless or single-pod setups.

## Prerequisites

- Redis 6+ accessible from all pods
- `@frontmcp/sdk` and `@frontmcp/cli` installed
- `FRONTMCP_DEPLOYMENT_MODE=distributed` environment variable

## Step 1: Configure @FrontMcp Decorator

```typescript
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  redis: { provider: 'redis', host: 'redis', port: 6379 },
  transport: {
    persistence: {
      redis: { provider: 'redis', host: 'redis', port: 6379 },
    },
  },
})
class Server {}
```

## Step 2: Create Configuration File

```typescript
// frontmcp.config.ts
import { defineConfig } from '@frontmcp/cli';

export default defineConfig({
  name: 'my-server',
  version: '1.0.0',
  deployments: [
    {
      target: 'distributed',
      ha: {
        heartbeatIntervalMs: 10000,
        heartbeatTtlMs: 30000,
        takeoverGracePeriodMs: 5000,
        redisKeyPrefix: 'mcp:ha:',
      },
    },
  ],
});
```

## Step 3: Build and Deploy

```bash
export FRONTMCP_DEPLOYMENT_MODE=distributed
frontmcp build --target distributed
```

Deploy with Docker or Kubernetes (see example below).

## Step 4: Verify Heartbeats

```bash
# Check heartbeat keys exist for each pod
redis-cli KEYS "mcp:ha:heartbeat:*"

# Inspect a heartbeat value
redis-cli GET "mcp:ha:heartbeat:mcp-server-7b8f9-abc12"
# Returns: {"nodeId":"mcp-server-7b8f9-abc12","startedAt":1712620800,"lastBeat":1712620810,"sessionCount":5}
```

## Configuration

| Field                   | Type   | Default   | Description                                      |
| ----------------------- | ------ | --------- | ------------------------------------------------ |
| `heartbeatIntervalMs`   | number | 10000     | How often each pod writes its heartbeat to Redis |
| `heartbeatTtlMs`        | number | 30000     | TTL for heartbeat key (should be 2-3x interval)  |
| `takeoverGracePeriodMs` | number | 5000      | Wait time before claiming orphaned sessions      |
| `redisKeyPrefix`        | string | `mcp:ha:` | Redis key prefix for all HA keys                 |

## Architecture

### Heartbeat Service

Each pod writes `mcp:ha:heartbeat:{nodeId}` to Redis every `heartbeatIntervalMs` with PX TTL of `heartbeatTtlMs`. The value contains `{ nodeId, startedAt, lastBeat, sessionCount }`. When a pod dies, the key expires.

### Session Takeover

When a request arrives for a session owned by a dead pod:

1. The live pod checks if the owner's heartbeat key exists
2. If missing, runs an atomic Lua CAS script: verifies `expectedOldNodeId`, updates `nodeId` + `reassignedAt`
3. Returns `{ claimed: true }` on success, `{ claimed: false }` if another pod won the race

### Notification Relay

Each pod subscribes to `mcp:ha:notify:{nodeId}` via Redis Pub/Sub. Cross-pod MCP notifications (progress updates, resource changes) are published to the target pod's channel for local delivery.

## Load Balancer Affinity

FrontMCP sets:

- **Cookie**: `__frontmcp_node` on Streamable HTTP initialize
- **Header**: `X-FrontMCP-Machine-Id` on every distributed response

NGINX sticky session example:

```nginx
upstream mcp_backend {
    hash $cookie___frontmcp_node consistent;
    server pod-1:3000;
    server pod-2:3000;
    server pod-3:3000;
}
```

## Common Patterns

| Pattern           | Correct                               | Incorrect                     | Why                                               |
| ----------------- | ------------------------------------- | ----------------------------- | ------------------------------------------------- |
| Heartbeat TTL     | `heartbeatTtlMs: 30000` (3x interval) | `heartbeatTtlMs: 10000` (1x)  | Too low causes false-positive pod death detection |
| Redis connections | Dedicated pub/sub + data connections  | Shared single connection      | Pub/Sub blocks the connection                     |
| Machine ID        | Let K8s set HOSTNAME                  | Override HOSTNAME in pod spec | Breaks session ownership mapping                  |

## Errors

| Error                       | When                                       | Solution                                                |
| --------------------------- | ------------------------------------------ | ------------------------------------------------------- |
| `SessionClaimConflictError` | Session claimed by another pod during race | Retry --- the load balancer will route to the new owner |
| `HaConfigurationError`      | Redis not configured for distributed mode  | Add `redis` to `@FrontMcp()` config                     |

## Verification Checklist

### Configuration

- [ ] `FRONTMCP_DEPLOYMENT_MODE=distributed` set in deployment
- [ ] Redis accessible from all pods
- [ ] `heartbeatTtlMs` >= 2x `heartbeatIntervalMs`
- [ ] Transport persistence configured with Redis

### Runtime

- [ ] `redis-cli KEYS "mcp:ha:heartbeat:*"` shows entries for each pod
- [ ] Killing a pod results in its heartbeat expiring within TTL
- [ ] Surviving pods claim orphaned sessions after takeover grace period
- [ ] `/healthz` and `/readyz` return healthy on all pods

## Troubleshooting

| Problem                                  | Cause                                  | Solution                               |
| ---------------------------------------- | -------------------------------------- | -------------------------------------- |
| Sessions not transferred after pod death | `heartbeatTtlMs` too high              | Lower to 15-20 seconds                 |
| `HaConfigurationError` on startup        | Missing Redis config                   | Add `redis` to `@FrontMcp()` decorator |
| Duplicate notifications                  | Shared Redis subscriber connection     | Use dedicated connections per relay    |
| Session takeover race failures           | High pod count + simultaneous restarts | Increase `takeoverGracePeriodMs`       |

## Examples

| Example                                                                              | Level        | Description                                                                          |
| ------------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------ |
| [`ha-kubernetes-3-replicas`](../examples/distributed-ha/ha-kubernetes-3-replicas.md) | Intermediate | Deploy FrontMCP with 3 replicas, Redis, and automatic session failover on Kubernetes |

> See all examples in [`examples/distributed-ha/`](../examples/distributed-ha/)

## Reference

- [Documentation](https://docs.agentfront.dev/frontmcp/deployment/high-availability)
- Related skills: `frontmcp-deployment`, `frontmcp-config`, `deploy-to-node`
