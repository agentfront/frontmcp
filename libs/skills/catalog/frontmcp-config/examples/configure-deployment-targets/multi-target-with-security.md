---
name: multi-target-with-security
reference: configure-deployment-targets
level: intermediate
description: Configure a FrontMCP project with node + distributed targets, CSP headers, and HSTS
tags: [config, deployment, csp, security, distributed, hsts, multi-target]
features:
  - Using defineConfig() for typed configuration with IDE autocomplete
  - Multi-target deployments with per-target server settings
  - CSP directives including value-less directives like upgrade-insecure-requests
  - Security headers (HSTS, X-Frame-Options, X-Content-Type-Options)
  - HA configuration for the distributed target
---

# Multi-Target Configuration with Security Headers

Configure a FrontMCP project that builds for both standalone Node.js and distributed (multi-pod) deployment, with full security headers.

## Code

```typescript
// frontmcp.config.ts
import { defineConfig } from '@frontmcp/cli';

export default defineConfig({
  name: 'secure-server',
  version: '1.0.0',
  deployments: [
    // Target 1: Standalone Node.js for development and single-server production
    {
      target: 'node',
      server: {
        http: { port: 3000 },
        csp: {
          enabled: true,
          directives: [
            "default-src 'self'",
            "script-src 'self' https://cdn.example.com",
            "style-src 'self' 'unsafe-inline'",
            'img-src * data:',
            'upgrade-insecure-requests',
          ].join('; '),
        },
        headers: {
          hsts: 'max-age=31536000; includeSubDomains; preload',
          contentTypeOptions: 'nosniff',
          frameOptions: 'SAMEORIGIN',
        },
      },
    },

    // Target 2: Distributed deployment with HA for Kubernetes
    {
      target: 'distributed',
      ha: {
        heartbeatIntervalMs: 5000,
        heartbeatTtlMs: 15000,
        takeoverGracePeriodMs: 3000,
      },
      server: {
        csp: {
          enabled: true,
          directives: "default-src 'self'; upgrade-insecure-requests",
          reportUri: 'https://report.example.com/csp',
          reportOnly: false,
        },
        headers: {
          hsts: 'max-age=63072000; includeSubDomains; preload',
          contentTypeOptions: 'nosniff',
          frameOptions: 'DENY',
        },
      },
    },
  ],
});
```

### Build Commands

```bash
# Build for standalone Node.js
frontmcp build --target node

# Build for distributed deployment
FRONTMCP_DEPLOYMENT_MODE=distributed frontmcp build --target distributed
```

### Verify Security Headers

```bash
# Check headers on standalone
curl -I http://localhost:3000/healthz

# Expected:
# Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.example.com; ...
# Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
# X-Content-Type-Options: nosniff
# X-Frame-Options: SAMEORIGIN
```

## What This Demonstrates

- Using `defineConfig()` for full TypeScript type checking and autocomplete
- Defining multiple deployment targets with independent server configurations
- CSP directives with both value-containing (`default-src 'self'`) and value-less (`upgrade-insecure-requests`) entries
- Per-target security header policies (SAMEORIGIN for dev, DENY for production)
- HA configuration scoped to the distributed target only

## Related

- See `configure-deployment-targets` for the full configuration reference
- See `distributed-ha` for the HA architecture deep dive
- See `deploy-to-node` for Docker and PM2 deployment
