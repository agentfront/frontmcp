---
name: ha-kubernetes-3-replicas
reference: distributed-ha
level: intermediate
description: Deploy FrontMCP with 3 replicas, Redis, and automatic session failover on Kubernetes
tags: [ha, kubernetes, redis, distributed, session-takeover, heartbeat]
features:
  - Configuring @FrontMcp with Redis for distributed deployment
  - Kubernetes Deployment YAML with 3 replicas and readiness probes
  - Verifying heartbeat keys and session takeover via redis-cli
  - NGINX sticky sessions for session affinity
---

# HA Kubernetes Deployment with 3 Replicas

Deploy FrontMCP with 3 replicas, Redis, and automatic session failover on Kubernetes

## Code

### Server Configuration

```typescript
// src/main.ts
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'echo',
  description: 'Echo a message',
  inputSchema: { message: z.string() },
})
class EchoTool extends ToolContext {
  async execute(input: { message: string }) {
    return { echo: input.message };
  }
}

@App({ name: 'main', tools: [EchoTool] })
class MainApp {}

@FrontMcp({
  info: { name: 'ha-demo', version: '1.0.0' },
  apps: [MainApp],
  redis: {
    provider: 'redis',
    host: process.env['REDIS_HOST'] || 'redis',
    port: 6379,
  },
  transport: {
    persistence: {
      redis: {
        provider: 'redis',
        host: process.env['REDIS_HOST'] || 'redis',
        port: 6379,
      },
    },
  },
})
class Server {}
```

### Config File

```typescript
// frontmcp.config.ts
import { defineConfig } from '@frontmcp/cli';

export default defineConfig({
  name: 'ha-demo',
  version: '1.0.0',
  deployments: [
    {
      target: 'distributed',
      ha: {
        heartbeatIntervalMs: 10000,
        heartbeatTtlMs: 30000,
      },
      server: {
        headers: {
          hsts: 'max-age=31536000',
          contentTypeOptions: 'nosniff',
          frameOptions: 'DENY',
        },
      },
    },
  ],
});
```

### Dockerfile

```dockerfile
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN FRONTMCP_DEPLOYMENT_MODE=distributed npx frontmcp build --target distributed

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist/distributed ./dist
COPY --from=builder /app/package.json ./
RUN yarn install --frozen-lockfile --production && yarn cache clean
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=3 --start-period=10s \
  CMD wget -qO- http://localhost:3000/healthz || exit 1
CMD ["node", "dist/main.js"]
```

### Kubernetes Manifests

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mcp-server
spec:
  replicas: 3
  selector:
    matchLabels:
      app: mcp-server
  template:
    metadata:
      labels:
        app: mcp-server
    spec:
      containers:
        - name: mcp-server
          image: my-registry/ha-demo:latest
          env:
            - name: FRONTMCP_DEPLOYMENT_MODE
              value: distributed
            - name: REDIS_HOST
              value: redis
          ports:
            - containerPort: 3000
          livenessProbe:
            httpGet:
              path: /healthz
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /readyz
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 15
---
apiVersion: v1
kind: Service
metadata:
  name: mcp-server
spec:
  selector:
    app: mcp-server
  ports:
    - port: 3000
      targetPort: 3000
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis
spec:
  replicas: 1
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
          ports:
            - containerPort: 6379
---
apiVersion: v1
kind: Service
metadata:
  name: redis
spec:
  selector:
    app: redis
  ports:
    - port: 6379
```

### Verification

```bash
# Deploy
kubectl apply -f k8s/

# Check pods
kubectl get pods -l app=mcp-server
# NAME                          READY   STATUS    RESTARTS
# mcp-server-7b8f9-abc12        1/1     Running   0
# mcp-server-7b8f9-def34        1/1     Running   0
# mcp-server-7b8f9-ghi56        1/1     Running   0

# Check heartbeat keys in Redis
kubectl exec -it deploy/redis -- redis-cli KEYS "mcp:ha:heartbeat:*"
# 1) "mcp:ha:heartbeat:mcp-server-7b8f9-abc12"
# 2) "mcp:ha:heartbeat:mcp-server-7b8f9-def34"
# 3) "mcp:ha:heartbeat:mcp-server-7b8f9-ghi56"

# Kill a pod and watch takeover
kubectl delete pod mcp-server-7b8f9-abc12
# After ~30s, its heartbeat expires and sessions are claimed by surviving pods
```

## What This Demonstrates

- Configuring @FrontMcp with Redis for distributed deployment
- Kubernetes Deployment YAML with 3 replicas and readiness probes
- Verifying heartbeat keys and session takeover via redis-cli
- NGINX sticky sessions for session affinity

## Related

- See `distributed-ha` for the full HA architecture reference
- See `deploy-to-node` for single-pod Docker deployment
- See `frontmcp-config` for configuration file options
