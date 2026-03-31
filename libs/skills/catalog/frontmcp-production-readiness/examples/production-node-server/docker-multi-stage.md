---
name: docker-multi-stage
reference: production-node-server
level: basic
description: 'Shows a production-ready Dockerfile with multi-stage build, non-root user, and container health check for a FrontMCP Node.js server.'
tags: [production, dockerfile, docker, security, node, multi]
features:
  - 'Multi-stage Docker build separating build dependencies from runtime'
  - 'Using `node:24-slim` as a minimal base image'
  - 'Running as non-root user (`USER node`) for security'
  - 'Container health check for orchestrator-aware restarts'
  - 'Resource limits (memory, CPU) in docker-compose'
---

# Multi-Stage Dockerfile with Health Check

Shows a production-ready Dockerfile with multi-stage build, non-root user, and container health check for a FrontMCP Node.js server.

## Code

```dockerfile
# Dockerfile
# Stage 1: Build
FROM node:24-slim AS builder
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN npx frontmcp build

# Stage 2: Runtime (minimal image)
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production && yarn cache clean
COPY --from=builder /app/dist ./dist

# Non-root user for security
USER node

# Health check for container orchestration
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

EXPOSE 3000
CMD ["node", "dist/main.js"]
```

```text
# .dockerignore
node_modules
.git
.env
.env.*
dist
coverage
*.md
.cache
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  mcp-server:
    build: .
    ports:
      - '3000:3000'
    environment:
      - NODE_ENV=production
      - PORT=3000
      - REDIS_HOST=redis
    depends_on:
      - redis
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '1.0'
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data

volumes:
  redis-data:
```

## What This Demonstrates

- Multi-stage Docker build separating build dependencies from runtime
- Using `node:24-slim` as a minimal base image
- Running as non-root user (`USER node`) for security
- Container health check for orchestrator-aware restarts
- Resource limits (memory, CPU) in docker-compose

## Related

- See `production-node-server` for the full Node.js/Docker checklist
