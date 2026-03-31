---
name: resource-limits
reference: deploy-to-node
level: advanced
description: 'Configure resource limits, health checks, and environment variables for a production FrontMCP deployment.'
tags: [deployment, docker-compose, docker, node, resource, limits]
features:
  - 'Setting CPU and memory limits/reservations in Docker Compose to prevent OOM kills'
  - 'Using `NODE_OPTIONS=--max-old-space-size` to align the V8 heap limit with the container memory'
  - 'Configuring health checks with appropriate `start_period` to allow the server time to initialize'
---

# Production Resource Limits and Health Checks

Configure resource limits, health checks, and environment variables for a production FrontMCP deployment.

## Code

```yaml
# docker-compose.yml with resource limits
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
      - NODE_OPTIONS=--max-old-space-size=384
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '1.0'
        reservations:
          memory: 256M
          cpus: '0.5'
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
    deploy:
      resources:
        limits:
          memory: 128M
          cpus: '0.5'
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s
      timeout: 3s
      retries: 5
    restart: unless-stopped

volumes:
  redis-data:
```

```bash
# Verify health check endpoint
curl http://localhost:3000/health
# {"status":"ok","uptime":12345}

# Monitor resource usage
docker stats --no-stream
```

## What This Demonstrates

- Setting CPU and memory limits/reservations in Docker Compose to prevent OOM kills
- Using `NODE_OPTIONS=--max-old-space-size` to align the V8 heap limit with the container memory
- Configuring health checks with appropriate `start_period` to allow the server time to initialize

## Related

- See `deploy-to-node` for the full deployment guide including Dockerfile, PM2, and NGINX setup
