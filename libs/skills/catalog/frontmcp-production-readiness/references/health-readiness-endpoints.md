---
name: health-readiness-endpoints
description: Configure /healthz and /readyz endpoints with custom probes, runtime-aware readiness, and dependency health checks
---

# Health & Readiness Endpoints

FrontMCP provides Kubernetes-style `/healthz` (liveness) and `/readyz` (readiness) endpoints with automatic dependency probing, catalog introspection, and runtime-aware behavior.

## Runtime Availability

| Runtime                    | `/healthz` | `/readyz` | Notes                              |
| -------------------------- | ---------- | --------- | ---------------------------------- |
| Node.js / Bun / Deno       | yes        | yes       | Full support                       |
| Edge / Cloudflare / Vercel | yes        | no        | No persistent connections to probe |
| CLI                        | yes        | no        | No HTTP server in stdio mode       |
| Browser                    | yes        | yes       | Full support                       |

## Default Behavior

Health endpoints are **enabled by default** with zero configuration:

```typescript
@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  // health endpoints are auto-registered:
  // GET /healthz  -> liveness probe
  // GET /readyz   -> readiness probe (Node.js, Bun, Deno, Browser)
  // GET /health   -> legacy alias for /healthz
})
export default class Server {}
```

## Endpoint Responses

### `/healthz` (Liveness)

Lightweight, no I/O. Returns server info, runtime context, and uptime.

```json
{
  "status": "ok",
  "server": { "name": "my-server", "version": "1.0.0" },
  "runtime": { "platform": "linux", "runtime": "node", "deployment": "standalone", "env": "production" },
  "uptime": 3600.5
}
```

- **HTTP 200**: Server process is alive
- **HTTP 503**: Server is in a degraded state

### `/readyz` (Readiness)

Deep check: probes all registered dependencies, returns catalog hash and registry counts.

```json
{
  "status": "ready",
  "totalLatencyMs": 45,
  "catalog": {
    "toolsHash": "a1b2c3d4e5f6...",
    "toolCount": 12,
    "resourceCount": 3,
    "promptCount": 2,
    "skillCount": 1,
    "agentCount": 0
  },
  "probes": {
    "session-store": { "status": "healthy", "latencyMs": 12 },
    "remote:payment-svc": { "status": "healthy", "latencyMs": 25 }
  }
}
```

- **HTTP 200**: All probes pass (`status: "ready"`)
- **HTTP 503**: At least one probe unhealthy (`status: "not_ready"`)

## Auto-Discovered Probes

The health service automatically registers probes for:

- **Session store** (Redis/Vercel KV) via `TransportService.pingSessionStore()`
- **Remote MCP apps** via the existing `HealthCheckManager` background checks

## Custom Probes

Add your own dependency checks via the `health.probes` config:

```typescript
@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  redis: { host: 'localhost' },
  health: {
    probes: [
      {
        name: 'postgres',
        async check() {
          const start = Date.now();
          await pool.query('SELECT 1');
          return { status: 'healthy', latencyMs: Date.now() - start };
        },
      },
      {
        name: 'external-api',
        async check() {
          const res = await fetch('https://api.example.com/ping');
          return { status: res.ok ? 'healthy' : 'unhealthy' };
        },
      },
    ],
  },
})
```

## Configuration Options

```typescript
health: {
  enabled: true,              // default: true
  healthzPath: '/healthz',    // default: '/healthz'
  readyzPath: '/readyz',      // default: '/readyz'
  includeDetails: false,      // default: true in dev, false in production
  readyz: {
    enabled: true,            // auto-determined by runtime when omitted
    timeoutMs: 5000,          // per-probe timeout, default: 5000
  },
  probes: [],                 // custom user-defined probes
}
```

### Probe Result Shape

Each probe must return:

```typescript
interface HealthProbeResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs?: number;
  details?: Record<string, unknown>;
  error?: string;
}
```

## Production Recommendations

- [ ] Set `includeDetails: false` in production to avoid leaking infrastructure topology
- [ ] Set `readyz.timeoutMs` to a value lower than your orchestrator's probe timeout
- [ ] Add custom probes for all external dependencies (databases, APIs, queues)
- [ ] Use the `toolsHash` from `/readyz` to detect config drift across instances
- [ ] Point Kubernetes liveness probe at `/healthz` and readiness probe at `/readyz`
- [ ] Point load balancer health checks at `/health` or `/healthz`

## Kubernetes Example

```yaml
livenessProbe:
  httpGet:
    path: /healthz
    port: 3001
  initialDelaySeconds: 5
  periodSeconds: 10
readinessProbe:
  httpGet:
    path: /readyz
    port: 3001
  initialDelaySeconds: 10
  periodSeconds: 15
  timeoutSeconds: 5
```

## Docker Example

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3001/healthz || exit 1
```

## Disabling Health Endpoints

```typescript
@FrontMcp({
  health: { enabled: false },
})
```

## Examples

| Example                                                                              | Level        | Description                                                                                |
| ------------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------ |
| [`basic-health-setup`](../examples/health-readiness-endpoints/basic-health-setup.md) | Basic        | Default health endpoints with Redis session store, showing /healthz and /readyz responses. |
| [`custom-probes`](../examples/health-readiness-endpoints/custom-probes.md)           | Intermediate | Custom database and API probes with Kubernetes deployment configuration.                   |

## Reference

- [Health Checks Documentation](https://docs.agentfront.dev/frontmcp/deployment/health-checks)
- Related skills: `frontmcp-observability`, `frontmcp-deployment`, `frontmcp-config`
