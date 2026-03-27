# ---- Build Stage ----

FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies first for better layer caching

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# Copy source and build

COPY . .
RUN yarn frontmcp build --target node

# ---- Production Stage ----

FROM node:22-alpine AS production

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

# Set ownership

RUN chown -R frontmcp:frontmcp /app

USER frontmcp

# Environment defaults

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
 CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/main.js"]
