---
name: deploy-to-node-dockerfile
description: Multi-stage Dockerfile for building and running a FrontMCP server in production
---

# Multi-Stage Dockerfile for FrontMCP

This reference shows the canonical multi-stage `Dockerfile` for building and running a FrontMCP server (`--target node`) in production.

## When to Use This Skill

### Must Use

- Containerizing a FrontMCP Node target server with Docker for production
- Producing a slim, non-root image for deployment to Kubernetes, ECS, Fly.io, etc.

### Recommended

- Pairing with `deploy-to-node` for Docker Compose, PM2, or NGINX setups
- Using a non-root user inside the container for security hardening

### Skip When

- Deploying serverless to Vercel, Lambda, or Cloudflare (no Dockerfile needed)
- Distributing a single-file binary -- use `build-for-cli` instead

## Reference Dockerfile

Save as `Dockerfile` in your project root. Adjust the package manager (`yarn`/`npm`/`pnpm`) to match your project.

```dockerfile
# ---- Build Stage ----
FROM node:24-alpine AS builder

WORKDIR /app

# Install dependencies first for better layer caching
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# Copy source and build for the Node.js target
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

# Set ownership and switch to non-root user
RUN chown -R frontmcp:frontmcp /app
USER frontmcp

# Environment defaults
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# FrontMCP exposes /healthz by default; /health is a legacy alias kept for
# backwards compatibility unless you set `health.healthzPath` to '/health'.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/healthz || exit 1

CMD ["node", "dist/main.js"]
```

## Build and Run

```bash
# Build the image
docker build -t my-frontmcp-server .

# Run the container
docker run -p 3000:3000 -e NODE_ENV=production my-frontmcp-server

# Verify
curl http://localhost:3000/healthz
```

## Notes

- The build stage installs all dependencies (including dev) so `frontmcp build --target node` can run; the production stage installs only `--production` deps.
- The non-root `frontmcp` user prevents container escape from running as `root`.
- For `dist/main.js` to exist, `frontmcp build --target node` must complete without errors. If your entry file is not `src/main.ts`, pass `-e ./path/to/entry.ts`.

## Examples

| Example                                                                                               | Level    | Description                                                                                |
| ----------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| [`basic-multistage-dockerfile`](../examples/deploy-to-node-dockerfile/basic-multistage-dockerfile.md) | Basic    | A minimal multi-stage Dockerfile for building and running a FrontMCP server in production. |
| [`secure-nonroot-dockerfile`](../examples/deploy-to-node-dockerfile/secure-nonroot-dockerfile.md)     | Advanced | A production Dockerfile with a non-root user, proper ownership, and security hardening.    |

> See all examples in [`examples/deploy-to-node-dockerfile/`](../examples/deploy-to-node-dockerfile/)

## Reference

- Related skills: `deploy-to-node`, `build-for-mcpb`
