---
name: docker-compose-with-redis
reference: deploy-to-node
level: basic
description: 'Deploy a FrontMCP server with Redis using Docker Compose for production.'
tags: [deployment, docker-compose, redis, dockerfile, docker, session]
features:
  - 'Multi-stage Dockerfile that keeps the production image small and secure'
  - 'Docker Compose configuration with Redis for session storage'
  - 'Health checks on both the FrontMCP server and Redis, with `depends_on` ensuring Redis starts first'
---

# Docker Compose with Redis

Deploy a FrontMCP server with Redis using Docker Compose for production.

## Code

```yaml
# docker-compose.yml
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

```dockerfile
# Dockerfile
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN npx frontmcp build --target node

FROM node:24-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/yarn.lock ./
RUN yarn install --frozen-lockfile --production && yarn cache clean
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "dist/main.js"]
```

```bash
# Build and start
docker compose up -d

# Verify
docker compose ps
curl http://localhost:3000/health
# {"status":"ok","uptime":12345}
```

## What This Demonstrates

- Multi-stage Dockerfile that keeps the production image small and secure
- Docker Compose configuration with Redis for session storage
- Health checks on both the FrontMCP server and Redis, with `depends_on` ensuring Redis starts first

## Related

- See `deploy-to-node` for PM2 process management, NGINX reverse proxy, and environment variable configuration
