---
name: secure-nonroot-dockerfile
reference: deploy-to-node-dockerfile
level: advanced
description: 'A production Dockerfile with a non-root user, proper ownership, and security hardening.'
tags: [deployment, dockerfile, docker, security, node, secure]
features:
  - 'Creating a dedicated non-root user (`frontmcp`) and switching to it with `USER`'
  - 'Setting file ownership before switching users so the process can read its own files'
  - 'Combining the Dockerfile with runtime resource limits (`--memory`, `--cpus`)'
---

# Secure Non-Root Dockerfile

A production Dockerfile with a non-root user, proper ownership, and security hardening.

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

# Create non-root user for security
RUN addgroup -S frontmcp && adduser -S frontmcp -G frontmcp

# Copy only production artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/yarn.lock ./

# Install production dependencies only
RUN yarn install --frozen-lockfile --production && \
    yarn cache clean

# Set ownership to non-root user
RUN chown -R frontmcp:frontmcp /app

USER frontmcp

# Environment defaults
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/main.js"]
```

```bash
# Build
docker build -t my-frontmcp-server:secure .

# Run with resource limits
docker run -p 3000:3000 \
  --memory=512m \
  --cpus=1.0 \
  -e NODE_ENV=production \
  -e REDIS_URL=redis://redis:6379 \
  my-frontmcp-server:secure

# Verify the process runs as non-root
docker exec $(docker ps -q -f ancestor=my-frontmcp-server:secure) whoami
# frontmcp
```

## What This Demonstrates

- Creating a dedicated non-root user (`frontmcp`) and switching to it with `USER`
- Setting file ownership before switching users so the process can read its own files
- Combining the Dockerfile with runtime resource limits (`--memory`, `--cpus`)

## Related

- See `deploy-to-node-dockerfile` for the complete reference Dockerfile
- See `deploy-to-node` for Docker Compose, PM2, and NGINX deployment patterns
