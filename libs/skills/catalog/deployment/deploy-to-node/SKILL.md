---
name: deploy-to-node
description: Deploy a FrontMCP server as a standalone Node.js application with Docker. Use when deploying to a VPS, Docker, or bare metal server.
tags:
  - deployment
  - node
  - docker
  - production
parameters:
  - name: port
    description: The port number the server will listen on
    type: number
    required: false
    default: 3000
examples:
  - scenario: Deploy with Docker Compose
    parameters:
      port: 3000
    expected-outcome: A FrontMCP server running inside a Docker container orchestrated by Docker Compose, with Redis for session storage and automatic restarts on failure.
  - scenario: Deploy to bare metal with PM2
    parameters:
      port: 8080
    expected-outcome: A FrontMCP server running directly on the host machine under PM2, listening on port 8080 with NGINX as a reverse proxy.
compatibility: Node.js 22+, Docker recommended
license: Apache-2.0
visibility: both
priority: 10
metadata:
  category: deployment
  difficulty: intermediate
  docs: https://docs.agentfront.dev/frontmcp/deployment/production-build
---

# Deploy a FrontMCP Server to Node.js

This skill walks you through deploying a FrontMCP server as a standalone Node.js application, optionally containerized with Docker for production use.

## Prerequisites

- Node.js 22 or later
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
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN npx frontmcp build --target node

# Stage 2: Production
FROM node:22-alpine AS production
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
    ports:
      - '6379:6379'
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

## Troubleshooting

- **Port already in use**: Change the `PORT` environment variable or stop the conflicting process.
- **Redis connection refused**: Verify Redis is running and `REDIS_URL` is correct. In Docker Compose, use the service name (`redis`) as the hostname.
- **Health check failing**: Increase `start_period` in the health check configuration to give the server more startup time.
- **Out of memory**: Increase the memory limit in Docker or use `NODE_OPTIONS="--max-old-space-size=1024" node dist/main.js`.
