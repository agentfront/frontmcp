---
name: production-node-server
description: Checklist for deploying FrontMCP as a long-running Node.js server with Docker
---

# Production Readiness: Node.js / Docker

Target-specific checklist for deploying FrontMCP as a long-running Node.js server (with or without Docker).

> Run the `common-checklist` first, then use this checklist for Node-specific items.

## Docker

- [ ] Dockerfile uses multi-stage build (separate build and runtime stages)
- [ ] Base image is minimal (`node:24-slim`, not full `node` image)
- [ ] Non-root user is configured: `USER node`
- [ ] `.dockerignore` excludes: `node_modules`, `.git`, `.env`, `dist`, `coverage`
- [ ] Container health check is defined: `HEALTHCHECK CMD curl -f http://localhost:3000/health`
- [ ] Resource limits (memory, CPU) are set in docker-compose or k8s deployment
- [ ] `NODE_ENV=production` is set in the container

## Process Management

- [ ] SIGTERM handler is configured for graceful shutdown
- [ ] In-flight requests complete before process exit
- [ ] Redis/database connections are closed on shutdown
- [ ] Health check returns unhealthy during shutdown drain period
- [ ] `/health` endpoint is implemented and monitored
- [ ] Health check verifies downstream dependencies (Redis, databases)
- [ ] Readiness probe is separate from liveness probe (if using K8s)

## Storage

- [ ] Redis is used for session storage (not in-memory)
- [ ] Redis connection pooling is configured
- [ ] Database connections use connection pools with limits
- [ ] Connection timeouts are set (don't hang indefinitely)
- [ ] Cache uses Redis (not in-memory) for multi-instance consistency

## Scaling

- [ ] Server is stateless (session state in Redis, not memory)
- [ ] Multiple instances can run behind a load balancer
- [ ] WebSocket/SSE connections use sticky sessions or Redis pub/sub
- [ ] Auto-scaling is configured based on CPU/memory/request metrics

## CI/CD

- [ ] Tests run on every PR (unit + E2E)
- [ ] `frontmcp build --target node` produces optimized output
- [ ] Docker image is built and pushed automatically
- [ ] Deployment is automated with rollback capability
- [ ] Database migrations run as a separate step

## Environment

- [ ] `NODE_ENV=production` is set
- [ ] All required env vars are documented in `.env.example`
- [ ] Env vars are validated at startup (fail fast on missing config)
- [ ] Port binding uses `process.env.PORT`
- [ ] No dev dependencies installed in production image

## Examples

| Example                                                                                | Level        | Description                                                                                                                                         |
| -------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docker-multi-stage`](../examples/production-node-server/docker-multi-stage.md)       | Basic        | Shows a production-ready Dockerfile with multi-stage build, non-root user, and container health check for a FrontMCP Node.js server.                |
| [`graceful-shutdown`](../examples/production-node-server/graceful-shutdown.md)         | Intermediate | Shows how to implement graceful shutdown with SIGTERM handling, in-flight request draining, and health check status transitions.                    |
| [`redis-session-scaling`](../examples/production-node-server/redis-session-scaling.md) | Advanced     | Shows how to configure Redis-backed session storage, connection pooling, and stateless server design for horizontal scaling behind a load balancer. |

> See all examples in [`examples/production-node-server/`](../examples/production-node-server/)
