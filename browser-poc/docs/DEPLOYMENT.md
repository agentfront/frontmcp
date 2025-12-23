# Deployment Guide

Production deployment guide for FrontMCP Browser applications.

## Table of Contents

- [Pre-Deployment Checklist](#pre-deployment-checklist)
- [Build Optimization](#build-optimization)
- [Content Security Policy](#content-security-policy)
- [Environment Configuration](#environment-configuration)
- [Hosting Options](#hosting-options)
- [Monitoring](#monitoring)
- [Performance Optimization](#performance-optimization)
- [Security Hardening](#security-hardening)
- [Rollback Strategy](#rollback-strategy)

---

## Pre-Deployment Checklist

### Security

- [ ] **Origin validation configured** - No wildcard origins in production
- [ ] **CSP headers set** - Content Security Policy configured
- [ ] **HTTPS enforced** - All MCP communication over HTTPS
- [ ] **Secrets removed** - No hardcoded API keys or tokens
- [ ] **Input validation** - All tool inputs validated with Zod schemas
- [ ] **Error messages sanitized** - No sensitive data in error responses
- [ ] **CSRF protection** - Tokens implemented for state-changing operations
- [ ] **Rate limiting** - Tool calls rate limited

### Performance

- [ ] **Bundle optimized** - Tree-shaking enabled, code split
- [ ] **Dependencies audited** - No unnecessary dependencies
- [ ] **Lazy loading** - MCP server initialized on demand
- [ ] **Store persistence** - IndexedDB configured correctly
- [ ] **Cache strategy** - Appropriate caching for resources

### Reliability

- [ ] **Error boundaries** - React error boundaries in place
- [ ] **Reconnection logic** - Transport handles disconnections
- [ ] **Timeout handling** - Tool calls have appropriate timeouts
- [ ] **Graceful degradation** - App works if MCP unavailable

### Testing

- [ ] **Unit tests pass** - All tests green
- [ ] **E2E tests pass** - Critical paths covered
- [ ] **Cross-browser tested** - Chrome, Firefox, Safari, Edge
- [ ] **Mobile tested** - Responsive and touch-friendly

---

## Build Optimization

### Bundle Size

```typescript
// vite.config.ts - Optimized configuration
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Separate vendor chunks
    rollupOptions: {
      output: {
        manualChunks: {
          frontmcp: ['@frontmcp/browser'],
          valtio: ['valtio'],
          zod: ['zod'],
        },
      },
    },
    // Enable minification
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // Remove console.log in production
        drop_debugger: true,
      },
    },
    // Generate sourcemaps for error tracking
    sourcemap: 'hidden',
  },
});
```

### Tree Shaking

```typescript
// Import only what you need
// Good - tree shakeable
import { createBrowserMcpServer } from '@frontmcp/browser';
import { PostMessageTransport } from '@frontmcp/browser/transport';

// Avoid - imports entire package
// import * as FrontMcp from '@frontmcp/browser';
```

### Code Splitting

```typescript
// Lazy load MCP server
const McpProvider = lazy(() => import('./components/McpProvider'));

function App() {
  return (
    <Suspense fallback={<Loading />}>
      <McpProvider>
        <AppContent />
      </McpProvider>
    </Suspense>
  );
}

// Dynamic tool imports
server.registerTool('heavy-analysis', {
  description: 'Perform complex analysis',
  execute: async (args) => {
    const { analyze } = await import('./analysis/heavy-processor');
    return analyze(args);
  },
});
```

---

## Content Security Policy

### Recommended CSP Headers

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'wasm-unsafe-eval';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  connect-src 'self' https://api.example.com;
  frame-src 'self' https://trusted-apps.example.com;
  frame-ancestors 'self' https://claude.ai https://app.claude.ai;
  worker-src 'self' blob:;
```

### CSP for Different Scenarios

```typescript
// Basic FrontMCP app (no iframes)
const basicCSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
].join('; ');

// FrontMCP app embedding other apps
const hostCSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  'frame-src https://trusted-app-1.com https://trusted-app-2.com',
  "worker-src 'self' blob:",
].join('; ');

// FrontMCP app embedded in Claude Desktop
const embeddedCSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  'frame-ancestors https://claude.ai https://app.claude.ai',
  "worker-src 'self' blob:",
].join('; ');
```

### Server Configuration

```nginx
# Nginx configuration
server {
    listen 443 ssl http2;
    server_name myapp.example.com;

    # Security headers
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; frame-ancestors 'self' https://claude.ai" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    # HTTPS redirect
    if ($scheme != "https") {
        return 301 https://$server_name$request_uri;
    }

    location / {
        root /var/www/myapp;
        try_files $uri $uri/ /index.html;
    }
}
```

---

## Environment Configuration

### Environment Variables

```typescript
// config.ts - Production configuration
interface Config {
  apiUrl: string;
  allowedOrigins: string[];
  debug: boolean;
  persistence: {
    enabled: boolean;
    dbName: string;
  };
  security: {
    csrfEnabled: boolean;
    maxToolExecutionTime: number;
    rateLimitPerMinute: number;
  };
}

function getConfig(): Config {
  const env = import.meta.env;

  return {
    apiUrl: env.VITE_API_URL || 'https://api.example.com',
    allowedOrigins: (env.VITE_ALLOWED_ORIGINS || '').split(',').filter(Boolean),
    debug: env.VITE_DEBUG === 'true',
    persistence: {
      enabled: env.VITE_PERSISTENCE !== 'false',
      dbName: env.VITE_DB_NAME || 'frontmcp-prod',
    },
    security: {
      csrfEnabled: env.VITE_CSRF_ENABLED !== 'false',
      maxToolExecutionTime: parseInt(env.VITE_MAX_TOOL_TIME || '30000', 10),
      rateLimitPerMinute: parseInt(env.VITE_RATE_LIMIT || '60', 10),
    },
  };
}

export const config = getConfig();
```

### Environment-Specific Builds

```bash
# .env.production
VITE_API_URL=https://api.example.com
VITE_ALLOWED_ORIGINS=https://claude.ai,https://app.claude.ai
VITE_DEBUG=false
VITE_PERSISTENCE=true
VITE_DB_NAME=frontmcp-prod
VITE_CSRF_ENABLED=true
VITE_MAX_TOOL_TIME=30000
VITE_RATE_LIMIT=60

# .env.staging
VITE_API_URL=https://staging-api.example.com
VITE_ALLOWED_ORIGINS=https://staging.claude.ai
VITE_DEBUG=true
VITE_PERSISTENCE=true
VITE_DB_NAME=frontmcp-staging
VITE_CSRF_ENABLED=true
```

---

## Hosting Options

### Static Hosting (Vercel, Netlify)

```json
// vercel.json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self'; frame-ancestors 'self' https://claude.ai"
        },
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        }
      ]
    }
  ],
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

```toml
# netlify.toml
[[headers]]
  for = "/*"
  [headers.values]
    Content-Security-Policy = "default-src 'self'; script-src 'self'; frame-ancestors 'self' https://claude.ai"
    X-Content-Type-Options = "nosniff"
    X-Frame-Options = "SAMEORIGIN"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

### Docker Deployment

```dockerfile
# Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  frontmcp-app:
    build: .
    ports:
      - '3000:80'
    environment:
      - NODE_ENV=production
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost/health']
      interval: 30s
      timeout: 10s
      retries: 3
```

### CDN Configuration

```typescript
// For CDN-hosted assets
const cdnConfig = {
  // Cache static assets aggressively
  cacheControl: {
    js: 'public, max-age=31536000, immutable',
    css: 'public, max-age=31536000, immutable',
    html: 'public, max-age=0, must-revalidate',
    json: 'public, max-age=3600',
  },
};
```

---

## Monitoring

### Error Tracking

```typescript
// Setup error tracking (Sentry example)
import * as Sentry from '@sentry/browser';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  beforeSend(event) {
    // Filter sensitive data
    if (event.request?.data) {
      event.request.data = '[FILTERED]';
    }
    return event;
  },
});

// Wrap MCP server with error tracking
const server = await createBrowserMcpServer({
  info: { name: 'MyApp', version: '1.0.0' },
  onError: (error) => {
    Sentry.captureException(error, {
      tags: { component: 'mcp-server' },
    });
  },
});
```

### Analytics

```typescript
// Track tool usage
function trackToolCall(name: string, duration: number, success: boolean) {
  analytics.track('mcp_tool_call', {
    tool: name,
    duration_ms: duration,
    success,
    timestamp: Date.now(),
  });
}

// Wrap tool execution
const originalExecute = tool.execute;
tool.execute = async (args) => {
  const start = performance.now();
  try {
    const result = await originalExecute(args);
    trackToolCall(tool.name, performance.now() - start, true);
    return result;
  } catch (error) {
    trackToolCall(tool.name, performance.now() - start, false);
    throw error;
  }
};
```

### Health Checks

```typescript
// Health check endpoint
server.registerResource('health://status', {
  name: 'Health Status',
  mimeType: 'application/json',
  read: async () => ({
    contents: [
      {
        uri: 'health://status',
        mimeType: 'application/json',
        text: JSON.stringify({
          status: 'healthy',
          version: __APP_VERSION__,
          timestamp: new Date().toISOString(),
          checks: {
            store: store.isReady(),
            transport: transport.isConnected,
            persistence: await checkPersistence(),
          },
        }),
      },
    ],
  }),
});
```

---

## Performance Optimization

### Store Optimization

```typescript
// Debounce persistence writes
const server = await createBrowserMcpServer({
  store: initialState,
  persistence: {
    name: 'myapp-prod',
    storage: 'indexeddb',
    debounceMs: 500, // Batch writes
    maxWritesPerSecond: 2,
  },
});

// Selective persistence - don't persist volatile data
const store = createMcpStore({
  user: {}, // Persist
  settings: {}, // Persist
  _cache: {}, // Don't persist (prefixed with _)
  _tempData: {}, // Don't persist
});
```

### Lazy Initialization

```typescript
// Defer MCP server creation until needed
let serverPromise: Promise<BrowserMcpServer> | null = null;

function getMcpServer(): Promise<BrowserMcpServer> {
  if (!serverPromise) {
    serverPromise = createBrowserMcpServer({
      info: { name: 'MyApp', version: '1.0.0' },
    });
  }
  return serverPromise;
}

// Only initialize when first tool is called
async function callTool(name: string, args: unknown) {
  const server = await getMcpServer();
  return server.callTool(name, args);
}
```

### Resource Caching

```typescript
// Cache expensive resource reads
const resourceCache = new Map<string, { data: unknown; expires: number }>();

server.registerResource('data://{id}', {
  read: async ({ id }) => {
    const cacheKey = `data://${id}`;
    const cached = resourceCache.get(cacheKey);

    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }

    const data = await fetchData(id);
    resourceCache.set(cacheKey, {
      data,
      expires: Date.now() + 60000, // 1 minute cache
    });

    return data;
  },
});
```

---

## Security Hardening

### Production Security Checklist

```typescript
// Production security configuration
const securityConfig = {
  // Strict origin validation
  transport: new PostMessageTransport(target, {
    origin: 'https://specific-origin.example.com', // Never '*'
    validateMessageStructure: true,
  }),

  // Rate limiting
  rateLimit: {
    maxCallsPerMinute: 60,
    maxCallsPerSecond: 5,
    blockDuration: 60000,
  },

  // Tool execution limits
  toolLimits: {
    maxExecutionTime: 30000,
    maxPayloadSize: 1024 * 1024, // 1MB
    maxConcurrentCalls: 5,
  },

  // Audit logging
  audit: {
    logAllToolCalls: true,
    logFailedAttempts: true,
    retentionDays: 90,
  },
};
```

### Secrets Management

```typescript
// Never hardcode secrets
// Bad:
// const API_KEY = 'sk-1234567890';

// Good - environment variables:
const API_KEY = import.meta.env.VITE_API_KEY;

// Better - fetch at runtime from secure backend:
async function getApiKey(): Promise<string> {
  const response = await fetch('/api/config/api-key', {
    credentials: 'include',
  });
  return response.json().then((r) => r.key);
}
```

---

## Rollback Strategy

### Feature Flags

```typescript
// Feature flag system
interface FeatureFlags {
  newToolEnabled: boolean;
  betaFeatures: boolean;
  legacyMode: boolean;
}

const flags = await fetchFeatureFlags();

// Conditional tool registration
if (flags.newToolEnabled) {
  server.registerTool('new-feature', newFeatureConfig);
}

// Runtime feature checks
server.registerTool('action', {
  execute: async (args) => {
    if (flags.betaFeatures) {
      return newImplementation(args);
    }
    return legacyImplementation(args);
  },
});
```

### Version Management

```typescript
// Support multiple versions during rollout
const VERSION = '2.0.0';
const SUPPORTED_VERSIONS = ['1.9.0', '2.0.0'];

server.registerResource('version://info', {
  read: async () => ({
    contents: [
      {
        uri: 'version://info',
        mimeType: 'application/json',
        text: JSON.stringify({
          current: VERSION,
          supported: SUPPORTED_VERSIONS,
          deprecated: ['1.8.0', '1.7.0'],
        }),
      },
    ],
  }),
});
```

### Rollback Procedure

```bash
# 1. Identify issue
# 2. Switch traffic to previous version
# 3. Deploy fix
# 4. Gradual rollout

# Example with Vercel
vercel rollback [deployment-url]

# Example with Docker
docker service update --rollback myservice
```

---

## See Also

- [SECURITY.md](./SECURITY.md) - Security best practices
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Common issues
- [TESTING.md](./TESTING.md) - Test strategies
- [DEBUGGING.md](./DEBUGGING.md) - Debug in production
