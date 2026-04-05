---
name: custom-probes
reference: health-readiness-endpoints
level: intermediate
description: 'Custom database and API probes with Kubernetes deployment configuration.'
tags: [production, health, readiness, kubernetes, postgres, probes, custom]
features:
  - 'Custom health probes for PostgreSQL and external API dependencies'
  - 'Kubernetes liveness and readiness probe configuration'
  - 'Production includeDetails: false to hide infrastructure topology'
  - 'Per-probe timeout to prevent slow dependencies from blocking readiness'
---

# Custom Health Probes with Kubernetes

Custom database and API probes with Kubernetes deployment configuration.

## Code

```typescript
// src/server.ts
import { FrontMcp } from '@frontmcp/sdk';
import { pool } from './db';
import { MyApp } from './apps/my-app';

@FrontMcp({
  info: { name: 'api-server', version: '2.1.0' },
  apps: [MyApp],
  http: { port: 3001 },
  redis: { host: process.env['REDIS_HOST'] ?? 'localhost' },
  health: {
    includeDetails: false, // don't leak infra topology in production
    readyz: {
      timeoutMs: 3000, // probes must respond within 3s
    },
    probes: [
      {
        name: 'postgres',
        async check() {
          const start = Date.now();
          try {
            await pool.query('SELECT 1');
            return { status: 'healthy', latencyMs: Date.now() - start };
          } catch (err) {
            return {
              status: 'unhealthy',
              latencyMs: Date.now() - start,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        },
      },
      {
        name: 'payment-api',
        async check() {
          const start = Date.now();
          const res = await fetch('https://api.payments.example.com/health', {
            signal: AbortSignal.timeout(2000),
          });
          return {
            status: res.ok ? 'healthy' : 'unhealthy',
            latencyMs: Date.now() - start,
          };
        },
      },
    ],
  },
})
export default class Server {}
```

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: api-server
          image: my-registry/api-server:2.1.0
          ports:
            - containerPort: 3001
          livenessProbe:
            httpGet:
              path: /healthz
              port: 3001
            initialDelaySeconds: 5
            periodSeconds: 10
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /readyz
              port: 3001
            initialDelaySeconds: 10
            periodSeconds: 15
            timeoutSeconds: 5
            failureThreshold: 2
          env:
            - name: REDIS_HOST
              value: redis-service
            - name: NODE_ENV
              value: production
```

When `includeDetails: false`, the `/readyz` response omits per-probe details:

```json
{
  "status": "ready",
  "totalLatencyMs": 45,
  "catalog": {
    "toolsHash": "a1b2c3d4...",
    "toolCount": 8,
    "resourceCount": 2,
    "promptCount": 1,
    "skillCount": 0,
    "agentCount": 0
  }
}
```

## What This Demonstrates

- Custom health probes for PostgreSQL and external API dependencies
- Kubernetes liveness and readiness probe configuration
- Production includeDetails: false to hide infrastructure topology
- Per-probe timeout to prevent slow dependencies from blocking readiness

## Related

- See `health-readiness-endpoints` for the full configuration reference
- See `frontmcp-observability` for tracing and monitoring integration
