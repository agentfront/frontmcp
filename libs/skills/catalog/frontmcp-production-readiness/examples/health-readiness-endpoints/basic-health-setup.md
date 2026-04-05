---
name: basic-health-setup
reference: health-readiness-endpoints
level: basic
description: 'Default health endpoints with Redis session store, showing /healthz and /readyz responses.'
tags: [production, health, readiness, redis, kubernetes, docker]
features:
  - 'Zero-config /healthz and /readyz endpoints enabled by default'
  - 'Auto-discovered session-store probe via Redis persistence'
  - 'Catalog hash for config drift detection across instances'
  - 'Docker HEALTHCHECK directive using /healthz'
---

# Basic Health Setup

Default health endpoints with Redis session store, showing /healthz and /readyz responses.

## Code

```typescript
// src/server.ts
import { FrontMcp } from '@frontmcp/sdk';
import { MyApp } from './apps/my-app';

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  http: { port: 3001 },
  redis: { host: 'localhost', port: 6379 },
  transport: {
    persistence: {}, // auto-uses global redis
  },
  // health endpoints are enabled by default:
  // GET /healthz  -> { status: 'ok', server: {...}, runtime: {...}, uptime: ... }
  // GET /readyz   -> { status: 'ready', catalog: {...}, probes: { 'session-store': {...} } }
  // GET /health   -> legacy alias for /healthz
})
export default class Server {}
```

```dockerfile
# ci/Dockerfile
FROM node:20-slim
WORKDIR /app
COPY dist/ ./dist/
COPY package.json ./
RUN npm ci --production
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3001/healthz || exit 1

CMD ["node", "dist/main.js"]
```

Test the endpoints:

```bash
# Liveness probe
curl http://localhost:3001/healthz
# {"status":"ok","server":{"name":"my-server","version":"1.0.0"},"runtime":{"platform":"linux","runtime":"node","deployment":"standalone","env":"production"},"uptime":42.5}

# Readiness probe (includes auto-discovered session-store probe)
curl http://localhost:3001/readyz
# {"status":"ready","totalLatencyMs":15,"catalog":{"toolsHash":"a1b2c3...","toolCount":5,"resourceCount":2,"promptCount":1,"skillCount":0,"agentCount":0},"probes":{"session-store":{"status":"healthy","latencyMs":3}}}

# Legacy endpoint (alias for /healthz)
curl http://localhost:3001/health
# same as /healthz
```

## What This Demonstrates

- Zero-config /healthz and /readyz endpoints enabled by default
- Auto-discovered session-store probe via Redis persistence
- Catalog hash for config drift detection across instances
- Docker HEALTHCHECK directive using /healthz

## Related

- See `health-readiness-endpoints` for custom probes and configuration options
