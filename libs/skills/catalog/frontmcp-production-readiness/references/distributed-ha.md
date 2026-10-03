---
name: distributed-ha
description: Deploy FrontMCP across multiple pods with heartbeat, cross-pod request relay, session takeover, and notification relay for zero-downtime failover
---

# Distributed High Availability

FrontMCP's HA module lets any pod receive any request of an MCP session, using Redis. Four components work together: HeartbeatService (liveness detection), request relay (a request for a session another live pod owns is served by that pod), session takeover (atomic CAS — a session whose owner stopped is served by the receiving pod), and NotificationRelay (cross-pod MCP notifications).

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
- The same `MCP_SESSION_SECRET` on every pod (session ids are encrypted with it; a pod with another secret answers other pods' sessions with `404`)

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
export MCP_SESSION_SECRET='<same value on every pod>'  # replace with your shared secret
frontmcp build --target distributed
```

The build writes the `ha` block to `FRONTMCP_HA_*` variables in the generated setup file (only when the platform has not set them), and every pod reads them at startup.

Deploy with Docker or Kubernetes (see example below).

## Step 4: Verify Heartbeats

```bash
# Check heartbeat keys exist for each pod
redis-cli --scan --pattern "mcp:ha:heartbeat:*"

# Inspect a heartbeat value
redis-cli GET "mcp:ha:heartbeat:mcp-server-7b8f9-abc12"
# Returns: {"nodeId":"mcp-server-7b8f9-abc12","startedAt":1712620800000,"lastBeat":1712620810000,"sessionCount":5}
```

## Configuration

| Field                   | Environment variable                | Type   | Default   | Description                                      |
| ----------------------- | ----------------------------------- | ------ | --------- | ------------------------------------------------ |
| `heartbeatIntervalMs`   | `FRONTMCP_HA_HEARTBEAT_INTERVAL_MS` | number | 10000     | How often each pod writes its heartbeat to Redis |
| `heartbeatTtlMs`        | `FRONTMCP_HA_HEARTBEAT_TTL_MS`      | number | 30000     | TTL for heartbeat key (should be 2-3x interval)  |
| `takeoverGracePeriodMs` | `FRONTMCP_HA_TAKEOVER_GRACE_MS`     | number | 5000      | Wait time before claiming orphaned sessions      |
| `redisKeyPrefix`        | `FRONTMCP_HA_KEY_PREFIX`            | string | `mcp:ha:` | Redis key prefix for all HA keys                 |

`heartbeatTtlMs` is also how long a request for a stopped pod's session is answered with `503` + `Retry-After` before another pod takes it over.

## Architecture

### Heartbeat Service

Each pod writes `mcp:ha:heartbeat:{nodeId}` to Redis every `heartbeatIntervalMs` with PX TTL of `heartbeatTtlMs`. The value contains `{ nodeId, startedAt, lastBeat, sessionCount }`. When a pod dies, the key expires.

### Request Relay

The owner of each session is recorded on the transport bus (`mcp:bus:session:{sessionId}`) and in the persisted session record. The hookable `relayToSessionOwner` stage of `http:request` (after the IP filter, before quota and auth) finds it — only for session ids the deployment minted (they decrypt under `MCP_SESSION_SECRET`), so other ids cost no Redis lookup; when it is another **live** pod the request (method, URL, headers, parsed body, client address) is published to `mcp:ha:notify:{ownerNodeId}`. The owner runs it through its own full `http:request` flow — auth, quota, transport and hooks run there — and streams the response (status, headers, each chunk, end; SSE included, with keepalive frames while it is quiet) back. A client disconnect aborts it on the owner. An owner that does not listen, does not acknowledge within 5s, loses its heartbeat mid-request, or sends nothing for three heartbeat intervals yields `503` + `Retry-After` (`SessionOwnerUnreachableError`), never a 500 (a response already started is ended). A response frame the owner cannot publish aborts the response there and ends it on the relaying pod. A relayed request is never relayed again.

### Session Takeover

When a request arrives for a session owned by a dead pod:

1. The live pod checks if the owner's heartbeat key exists
2. If missing, runs an atomic Lua CAS script: verifies `expectedOldNodeId`, updates `nodeId` + `reassignedAt`
3. On success it recreates the transport from the persisted session (keeping `reassignedAt` / `reassignedFrom`), records itself as owner on the bus, and serves the request; if another pod won the race, it relays the request to that pod

A pod whose heartbeat lapsed (Redis unreachable for `heartbeatTtlMs`) may have lost sessions it still holds. Before serving one again it re-reads the persisted record (once per lapse); if another pod owns it now, it drops its transport, leaves the record to the new owner, and relays the request there. While Redis stays unreachable it keeps serving what it holds.

Takeover needs `transport.persistence` (Streamable HTTP only — an SSE stream cannot move to another pod).

### Notification Relay

Each pod subscribes to `mcp:ha:notify:{nodeId}` via Redis Pub/Sub. A notification for a session on another pod is published to the channel of the pod that owns it (looked up on the bus) and delivered there; it is never relayed twice.

## Redis Connection, TTL and Recovery

- HA uses one dedicated ioredis client built from the top-level `redis` config (host/port/password/db/tls or `url`) for commands and publishing, plus a second connection for the relay channel subscription (retried 1s→30s until it succeeds). Both reconnect on their own, log errors at a rate-limited interval, and are closed on shutdown. Vercel KV cannot back HA.
- The orphan scanner reads `<keyPrefix>session:` (default `mcp:session:`, as `keyPrefix` defaults to `mcp:`), the same prefix the session store writes, and only runs when `transport.persistence.redis` is set. A claimed session is re-advertised on the bus, so every pod relays its next requests to the claimer, which recreates the transport on the first one.
- Session TTL is `persistence.defaultTtlMs`, then `persistence.redis.defaultTtlMs`, then 1 hour. The pod serving a session refreshes it at most once per quarter TTL.
- If Redis is unreachable at startup the server still starts; the session store retries with exponential backoff (1s doubling to 30s) and persistence resumes without a restart.
- `.frontmcp/machine-id` is only read/written in standalone development (never in `distributed` or `serverless`); in Kubernetes the machine ID is `HOSTNAME`.

## Load Balancer Affinity

FrontMCP sets:

- **Cookie**: `__frontmcp_node` on Streamable HTTP initialize
- **Header**: `X-FrontMCP-Machine-Id` on every distributed response (initialize, message POSTs, DELETE, stateless and MCP 2026-07-28 requests, SSE, `/healthz`, `/readyz`, `/metrics` and 404s). The Express host and the web-fetch handler add it next to the security headers; the session flows also set it in the hookable `applyNodeHeaders` stage. Only distributed mode (`FRONTMCP_DEPLOYMENT_MODE=distributed`) sends it

Affinity is an optimization: without it a request on the wrong pod is relayed to the owner (one Redis round trip each way). NGINX sticky session example:

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

| Error                          | When                                                                                        | Solution                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `SessionOwnerUnreachableError` | `503` + `Retry-After`: owner alive by heartbeat but did not answer the relay (just stopped) | Retry after `Retry-After` seconds; by then the owner answers or is taken over |
| `SessionClaimConflictError`    | Takeover lost to a pod that is gone too, or the session expired (client gets `404`)         | None — a lost race against a live pod is relayed to it instead                |
| `HaConfigurationError`         | Redis not configured for distributed mode                                                   | Add `redis` to `@FrontMcp()` config                                           |

## Verification Checklist

### Configuration

- [ ] `FRONTMCP_DEPLOYMENT_MODE=distributed` set in deployment
- [ ] Same `MCP_SESSION_SECRET` on every pod
- [ ] Redis accessible from all pods
- [ ] `heartbeatTtlMs` >= 2x `heartbeatIntervalMs`
- [ ] Transport persistence configured with Redis

### Runtime

- [ ] `redis-cli --scan --pattern "mcp:ha:heartbeat:*"` shows entries for each pod
- [ ] `redis-cli PUBSUB CHANNELS "mcp:ha:notify:*"` lists one channel per pod
- [ ] A request sent to a pod that does not own the session is answered (relayed; `X-FrontMCP-Machine-Id` names the owner)
- [ ] Killing a pod results in its heartbeat expiring within TTL
- [ ] Surviving pods claim orphaned sessions after takeover grace period (`redis-cli HGETALL "mcp:bus:session:<id>"` names the new owner)
- [ ] `/healthz` and `/readyz` return healthy on all pods

## Troubleshooting

| Problem                                    | Cause                                          | Solution                                                                                                                                          |
| ------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `503` "did not answer the relayed request" | Owner just stopped (heartbeat not expired yet) | Expected for up to `heartbeatTtlMs`; the client retries after `Retry-After` and the session is taken over                                         |
| `404` on another pod for a live session    | Pods use different `MCP_SESSION_SECRET`        | Give every pod the same `MCP_SESSION_SECRET`                                                                                                      |
| Sessions not transferred after pod death   | `heartbeatTtlMs` too high                      | Lower TTL while keeping >= 2x interval (e.g., 20-30s for a 10s interval)                                                                          |
| `HaConfigurationError` on startup          | Missing Redis config                           | Add `redis` to `@FrontMcp()` decorator                                                                                                            |
| Duplicate notifications                    | Shared Redis subscriber connection             | Use dedicated connections per relay                                                                                                               |
| Sessions expire too early or too late      | TTL not configured                             | Set `transport.persistence.defaultTtlMs` (or `persistence.redis.defaultTtlMs`); default is 1 hour and slides while the owning pod serves requests |
| Redis was down when pods started           | Startup connect failed                         | Nothing to do: the session store reconnects with backoff (1s to 30s) and `/readyz` turns 200                                                      |
| Session takeover race failures             | High pod count + simultaneous restarts         | Increase `takeoverGracePeriodMs`                                                                                                                  |

## Examples

| Example                                                                              | Level        | Description                                                                          |
| ------------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------ |
| [`ha-kubernetes-3-replicas`](../examples/distributed-ha/ha-kubernetes-3-replicas.md) | Intermediate | Deploy FrontMCP with 3 replicas, Redis, and automatic session failover on Kubernetes |

> See all examples in [`examples/distributed-ha/`](../examples/distributed-ha/)

## Reference

- [Documentation](https://docs.agentfront.dev/frontmcp/deployment/high-availability)
- Related skills: `frontmcp-deployment`, `frontmcp-config`, `deploy-to-node`
