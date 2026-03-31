---
name: basic-multistage-dockerfile
reference: deploy-to-node-dockerfile
level: basic
description: 'A minimal multi-stage Dockerfile for building and running a FrontMCP server in production.'
tags: [deployment, dockerfile, docker, node, multistage]
features:
  - 'Two-stage build: the first stage installs all dependencies and builds; the second copies only production artifacts'
  - 'Using `yarn install --production` in the production stage to exclude dev dependencies'
  - 'A health check that verifies the server is responding'
---

# Basic Multi-Stage Dockerfile

A minimal multi-stage Dockerfile for building and running a FrontMCP server in production.

## Code

```dockerfile
# Dockerfile

# ---- Build Stage ----
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn frontmcp build --target node

# ---- Production Stage ----
FROM node:24-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/yarn.lock ./
RUN yarn install --frozen-lockfile --production && \
    yarn cache clean
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1
CMD ["node", "dist/main.js"]
```

```bash
# Build and run the container
docker build -t my-frontmcp-server .
docker run -p 3000:3000 -e NODE_ENV=production my-frontmcp-server

# Verify
curl http://localhost:3000/health
```

## What This Demonstrates

- Two-stage build: the first stage installs all dependencies and builds; the second copies only production artifacts
- Using `yarn install --production` in the production stage to exclude dev dependencies
- A health check that verifies the server is responding

## Related

- See `deploy-to-node-dockerfile` for the complete reference Dockerfile with security hardening
