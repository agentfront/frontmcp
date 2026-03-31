---
name: deploy-to-node
description: Deploy a FrontMCP server as a standalone Node.js app with Docker and process managers
---

# Deploy a FrontMCP Server to Node.js

This skill walks you through deploying a FrontMCP server as a standalone Node.js application, optionally containerized with Docker for production use.

## When to Use This Skill

### Must Use

- Deploying a FrontMCP server to a VPS, dedicated server, or bare-metal infrastructure
- Running a long-lived Node.js process that needs full control over the runtime environment
- Containerizing a FrontMCP server with Docker or Docker Compose for self-hosted production

### Recommended

- Using PM2 or systemd to manage a FrontMCP process with automatic restarts
- Deploying behind NGINX or another reverse proxy for TLS termination and load balancing
- Running in environments where serverless cold starts are unacceptable

### Skip When

- Deploying to Vercel -- use `deploy-to-vercel` instead
- Deploying to AWS Lambda -- use `deploy-to-lambda` instead
- You need zero-ops serverless scaling and do not require persistent connections or long-running processes

> **Decision:** Choose this skill when you need a persistent Node.js process with full infrastructure control; choose a serverless skill when you want managed scaling.

## Prerequisites

- Node.js 24 or later
- Docker and Docker Compose (recommended for production)
- A FrontMCP project ready to build

## Step 1: Build the Server

```bash
frontmcp build --target node
```

This compiles your TypeScript source, bundles dependencies, and produces a production-ready output in `dist/`. The build output includes compiled JavaScript optimized for Node.js, a `package.json` with production dependencies only, and any static assets.

## Step 2: Dockerfile (Multi-Stage)

Create a multi-stage `Dockerfile` in your project root:

```dockerfile
# Stage 1: Build
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN npx frontmcp build --target node

# Stage 2: Production
FROM node:24-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
RUN yarn install --frozen-lockfile --production && yarn cache clean
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "dist/main.js"]
```

The first stage installs all dependencies and builds the project. The second stage copies only the compiled output and production dependencies into a slim image.

## Step 3: Docker Compose with Redis

Create a `docker-compose.yml` for a complete deployment with Redis:

```yaml
version: '3.9'

services:
  frontmcp:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - '${PORT:-3000}:3000'
    environment:
      - NODE_ENV=production
      - PORT=3000
      - REDIS_URL=redis://redis:6379
      - LOG_LEVEL=info
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ['CMD', 'wget', '-qO-', 'http://localhost:3000/health']
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s
      timeout: 3s
      retries: 5
    restart: unless-stopped

volumes:
  redis-data:
```

Deploy with:

```bash
docker compose up -d
```

## Step 4: Environment Variables

Create a `.env` file or set variables in your deployment environment:

```bash
# Server
PORT=3000
NODE_ENV=production
HOST=0.0.0.0

# Redis (required for session storage in production)
REDIS_URL=redis://localhost:6379

# Logging
LOG_LEVEL=info
```

| Variable    | Description                         | Default       |
| ----------- | ----------------------------------- | ------------- |
| `PORT`      | HTTP port for the server            | `3000`        |
| `NODE_ENV`  | Runtime environment                 | `development` |
| `REDIS_URL` | Redis connection string for storage | (none)        |
| `HOST`      | Network interface to bind           | `0.0.0.0`     |
| `LOG_LEVEL` | Logging verbosity                   | `info`        |

## Step 5: Health Checks

FrontMCP servers expose a `/health` endpoint by default:

```bash
curl http://localhost:3000/health
# Response: { "status": "ok", "uptime": 12345 }
```

For Docker, the `HEALTHCHECK` directive in the Dockerfile and the `healthcheck` block in Compose handle this automatically. Point your load balancer or orchestrator at this endpoint for liveness checks.

## Step 6: PM2 for Bare Metal

When running without Docker, use PM2 as a process manager:

```bash
# Install PM2 globally
npm install -g pm2

# Start the server with cluster mode (one instance per CPU core)
pm2 start dist/main.js --name frontmcp-server -i max

# Save the process list for auto-restart on reboot
pm2 save
pm2 startup
```

The `-i max` flag runs one instance per CPU core for optimal throughput.

## Step 7: NGINX Reverse Proxy

Place NGINX in front of the server for TLS termination:

```nginx
server {
    listen 443 ssl;
    server_name mcp.example.com;

    ssl_certificate     /etc/ssl/certs/mcp.example.com.pem;
    ssl_certificate_key /etc/ssl/private/mcp.example.com.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Resource Limits

Set appropriate limits in Docker Compose for production:

```yaml
services:
  frontmcp:
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '1.0'
        reservations:
          memory: 256M
          cpus: '0.5'
```

## Common Patterns

| Pattern                   | Correct                              | Incorrect                                        | Why                                                                 |
| ------------------------- | ------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------- |
| Build command             | `frontmcp build --target node`       | `tsc && node dist/main.js`                       | The FrontMCP build bundles deps and produces an optimized output    |
| Docker base image         | `node:24-alpine` (multi-stage)       | `node:24` (single stage with dev deps)           | Multi-stage keeps the production image small and secure             |
| Process manager           | PM2 with `-i max` cluster mode       | Running `node dist/main.js` directly via `nohup` | PM2 handles restarts, logging, and multi-core clustering            |
| Redis hostname in Compose | Service name `redis`                 | `localhost` or `127.0.0.1`                       | Containers communicate via Docker's internal DNS, not localhost     |
| Environment config        | `.env` file or orchestrator env vars | Hardcoded values in source code                  | Keeps secrets out of the codebase and allows per-environment config |

## Verification Checklist

**Build**

- [ ] `frontmcp build --target node` completes without errors
- [ ] `dist/main.js` exists and is runnable with `node dist/main.js`

**Docker**

- [ ] `docker compose up -d` starts all services without errors
- [ ] `docker compose ps` shows all containers as healthy
- [ ] `curl http://localhost:3000/health` returns `{"status":"ok"}`

**Production Readiness**

- [ ] `NODE_ENV` is set to `production`
- [ ] Redis is reachable and `REDIS_URL` is configured
- [ ] Resource limits (memory, CPU) are defined in Compose or the orchestrator
- [ ] NGINX or another reverse proxy handles TLS termination
- [ ] Logs are collected and rotated (Docker log driver or PM2 log rotation)

## Troubleshooting

| Problem                      | Cause                                        | Solution                                                                                    |
| ---------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Port already in use          | Another process is bound to the same port    | Change the `PORT` environment variable or stop the conflicting process with `lsof -i :3000` |
| Redis connection refused     | Redis is not running or `REDIS_URL` is wrong | Verify Redis is running; in Docker Compose use the service name (`redis`) as the hostname   |
| Health check failing         | Server has not finished starting             | Increase `start_period` in the Docker health check to give the server more startup time     |
| Out of memory (OOM kill)     | Container memory limit is too low            | Increase the memory limit in Docker or set `NODE_OPTIONS="--max-old-space-size=1024"`       |
| PM2 not restarting on reboot | Startup hook was not saved                   | Run `pm2 save && pm2 startup` to persist the process list across reboots                    |

## Examples

| Example                                                                                | Level        | Description                                                                                               |
| -------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------- |
| [`docker-compose-with-redis`](../examples/deploy-to-node/docker-compose-with-redis.md) | Basic        | Deploy a FrontMCP server with Redis using Docker Compose for production.                                  |
| [`pm2-with-nginx`](../examples/deploy-to-node/pm2-with-nginx.md)                       | Intermediate | Deploy a FrontMCP server on bare metal using PM2 for process management and NGINX for TLS termination.    |
| [`resource-limits`](../examples/deploy-to-node/resource-limits.md)                     | Advanced     | Configure resource limits, health checks, and environment variables for a production FrontMCP deployment. |

> See all examples in [`examples/deploy-to-node/`](../examples/deploy-to-node/)

## Reference

- **Docs:** https://docs.agentfront.dev/frontmcp/deployment/production-build
- **Related skills:** `deploy-to-vercel`, `deploy-to-lambda`
