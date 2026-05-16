---
name: metrics-endpoint
description: Configure the off-by-default /metrics endpoint that exposes process metrics and framework counters in Prometheus text format
---

# /metrics Endpoint (issue #397)

Expose process metrics (CPU, RSS, heap, event-loop lag) and every framework counter (`frontmcp_skills_*_total`, plus any counter emitted via `createCounter()`) as a Prometheus scrape endpoint on the same HTTP listener as `/healthz`. The endpoint is **OFF by default** — turn it on with `metrics: { enabled: true }`.

## When to use

- Cluster operators want a `/metrics` URL for Prometheus / Grafana Agent / OpenTelemetry Collector to scrape.
- Kubernetes HPA / Vercel autoscaling needs a pull endpoint instead of an OTel push pipeline.
- On-call engineers need `curl :PORT/metrics | grep event_loop` without installing cluster-side tooling first.
- The host wants both push (via OTel `MeterProvider`) and pull (this endpoint) — they read from the same in-memory counter store, so values stay consistent.

## Enable with defaults

```typescript
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  metrics: { enabled: true },
})
class Server {}
```

Then scrape: `curl http://localhost:3001/metrics` — Content-Type is the canonical Prometheus `text/plain; version=0.0.4; charset=utf-8`.

## Configuration

```typescript
@FrontMcp({
  metrics: {
    enabled: true,                       // default: false
    path: '/metrics',                    // default: '/metrics'
    format: 'prometheus',                // 'prometheus' | 'json'
    auth: 'public',                      // 'public' | 'token' | { token: string }
    tokenEnv: 'FRONTMCP_METRICS_TOKEN',  // env var read at startup when auth: 'token'
    include: ['process', 'skills'],      // optional category filter
    process: {
      eventLoopLag: true,                // mean + p99 event-loop lag gauge
      fdCount: true,                     // Linux /proc/self/fd count
      activeHandles: true,               // libuv handle / request counts
    },
  },
})
```

## What gets emitted

| Category           | Examples                                                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Process gauges     | `frontmcp_process_resident_memory_bytes`, `frontmcp_process_heap_bytes`, `frontmcp_process_uptime_seconds`, `frontmcp_process_cpu_seconds_total{mode}`          |
| Node.js gauges     | `frontmcp_nodejs_eventloop_lag_seconds{quantile}`, `frontmcp_nodejs_active_handles`, `frontmcp_nodejs_active_requests`, `frontmcp_nodejs_open_fds` (Linux only) |
| Framework counters | `frontmcp_skills_bundle_pulls_total`, `frontmcp_skills_signature_*_total`, `frontmcp_skills_replay_*_total`, `frontmcp_skills_audit_*_total`                    |
| Custom counters    | Anything emitted via `createCounter('my_total').inc()` from `@frontmcp/observability`                                                                           |

## Token auth

```typescript
metrics: {
  enabled: true,
  auth: 'token',
  tokenEnv: 'FRONTMCP_METRICS_TOKEN',
}
```

Fails fast at startup with `MetricsTokenNotConfiguredError` when the env var is unset — a token-gated endpoint never silently downgrades to public.

| Request                           | Status |
| --------------------------------- | ------ |
| no `Authorization` header         | 401    |
| `Authorization: Bearer <wrong>`   | 403    |
| `Authorization: Bearer <correct>` | 200    |

## Off-by-default rationale

Process metrics, framework counter names, and tool vocabularies can hint at deployment scale and feature usage (e.g. `frontmcp_skills_signature_failures_total` reveals a signing infra exists). Recommendations:

- **Internet-exposed deployments**: use `auth: 'token'` or terminate at a sidecar/ingress with a network ACL.
- **Cluster-local deployments**: `auth: 'public'` matches the Prometheus / Kubernetes convention.

## Add custom counters

```typescript
import { createCounter } from '@frontmcp/observability';

const cacheHits = createCounter('my_cache_hits_total', 'Cache hits by tier');

// In a tool / provider:
cacheHits.inc(1, { tier: 'l1' });
```

The next scrape will include:

```
# TYPE my_cache_hits_total counter
my_cache_hits_total{tier="l1"} 1
```

Keep label values bounded (status codes, enum members, tool names) — unbounded values blow up the timeseries count.

## Path conflict guard

`metrics.path` MUST NOT collide with MCP transport paths (`/mcp`, `/sse`, `/messages`). The service constructor throws `MetricsPathConflictError` at startup if it detects an overlap.

## Common Patterns

| Pattern           | Correct                                                                         | Incorrect                                                     | Why                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Enable endpoint   | `metrics: { enabled: true }`                                                    | Omit `metrics:` and hope it's on                              | The endpoint is opt-in; default is OFF for security                                                           |
| Internet exposure | `metrics: { enabled: true, auth: 'token', tokenEnv: 'FRONTMCP_METRICS_TOKEN' }` | `metrics: { enabled: true, auth: 'public' }` on a public host | `auth: 'public'` is for cluster-local convention only                                                         |
| Custom counters   | `createCounter('foo_total').inc(1, { status: 'ok' })`                           | `prom-client` `new Counter({...})`                            | The framework reads from `@frontmcp/observability`'s in-memory store; only `createCounter()` flows through it |
| Label cardinality | `{ status: 'ok' \| 'error' }`                                                   | `{ user_id: '<jwt-sub>' }`                                    | Unbounded label values blow up the timeseries count                                                           |

## Verification Checklist

### Configuration

- [ ] `metrics: { enabled: true }` is set in `@FrontMcp({ ... })`
- [ ] For internet-exposed deployments, `auth: 'token'` + `tokenEnv` are set AND the env var is exported in the deployment
- [ ] `metrics.path` does NOT start with `/mcp`, `/sse`, or `/messages`
- [ ] If using `include[]`, every category name is from the enum (`process` | `tools` | `resources` | `http` | `storage` | `skills` | `auth` | `sessions`)

### Runtime

- [ ] `curl http://<host>:<port>/metrics` returns 200 with Content-Type `text/plain; version=0.0.4; charset=utf-8`
- [ ] Output contains at least one `frontmcp_process_*` gauge (proves the process-stats collector ran)
- [ ] Output contains every `frontmcp_skills_*_total` counter incremented since startup
- [ ] When `auth: 'token'`, requests without `Authorization: Bearer …` return 401 and wrong tokens return 403
- [ ] Default `@FrontMcp({})` (no `metrics:` key) → `GET /metrics` returns 404 (route was never registered)

## Troubleshooting

| Problem                                                 | Cause                                                                                                          | Solution                                                                                             |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /metrics` returns 404                              | `metrics.enabled` is `false` (default)                                                                         | Set `metrics: { enabled: true }`                                                                     |
| Server throws `MetricsTokenNotConfiguredError` at boot  | `auth: 'token'` set but the env var is empty                                                                   | Export the env var, or switch `auth` to `'public'` / `{ token: '...' }`                              |
| Server throws `MetricsPathConflictError` at boot        | `metrics.path` starts with `/mcp`, `/sse`, or `/messages`                                                      | Pick a non-MCP path like `/metrics` or `/internal/metrics`                                           |
| Custom `createCounter()` values missing from the scrape | Counter was created on a different `@frontmcp/observability` module instance (e.g. duplicated in node_modules) | Ensure single `@frontmcp/observability` install via `yarn dedupe` / `npm ls @frontmcp/observability` |
| OTel push pipeline and `/metrics` show different values | Counters created outside `createCounter()` (e.g. raw `prom-client`) bypass the in-memory store                 | Use `createCounter()` from `@frontmcp/observability` for everything; both paths read the same store  |

## Examples

| Example                                                                              | Level | Description                                                          |
| ------------------------------------------------------------------------------------ | ----- | -------------------------------------------------------------------- |
| [`enable-metrics-endpoint`](../examples/metrics-endpoint/enable-metrics-endpoint.md) | Basic | Turn on the /metrics endpoint with defaults and scrape it with curl. |

## Accessing This Skill

This skill is available over MCP under the `skill://metrics-endpoint/SKILL.md` URI per SEP-2640, and as a reference page in the `frontmcp-observability` router.

## Reference

- Docs: https://docs.agentfront.dev/frontmcp/deployment/metrics
- Issue tracker: https://github.com/agentfront/frontmcp/issues/397
- SDK exports: `MetricsService`, `registerMetricsRoutes`, `MetricsPathConflictError`, `MetricsTokenNotConfiguredError`
- Observability exports: `renderPrometheusExposition`, `renderJsonExposition`, `ProcessStatsCollector`, `PROMETHEUS_CONTENT_TYPE`
