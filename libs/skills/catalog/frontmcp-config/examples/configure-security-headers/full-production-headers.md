---
name: full-production-headers
reference: configure-security-headers
level: intermediate
description: Complete security headers configuration for production with CSP enforcement, HSTS preload, and clickjacking protection
tags: [config, csp, security, hsts, production, headers, frame-options]
features:
  - Full CSP enforcement with multiple directive types including value-less directives
  - HSTS with preload and includeSubDomains for HTTPS enforcement
  - X-Frame-Options DENY for clickjacking protection
  - Custom headers for additional security controls
---

# Full Production Security Headers

Complete security headers configuration for production with CSP enforcement, HSTS preload, and clickjacking protection

## Code

```typescript
// frontmcp.config.ts
import { defineConfig } from '@frontmcp/cli';

export default defineConfig({
  name: 'production-server',
  version: '1.0.0',
  deployments: [
    {
      target: 'distributed',
      ha: {
        heartbeatIntervalMs: 10000,
        heartbeatTtlMs: 30000,
      },
      server: {
        http: { port: 3000 },
        csp: {
          enabled: true,
          reportOnly: false, // Enforce (not just report)
          directives: {
            'default-src': "'self'",
            'script-src': "'self' https://cdn.example.com",
            'style-src': "'self' 'unsafe-inline'",
            'img-src': '* data: blob:',
            'font-src': "'self' https://fonts.gstatic.com",
            'connect-src': "'self' https://api.example.com wss://ws.example.com",
            'frame-ancestors': "'none'",
            'base-uri': "'self'",
            'form-action': "'self'",
            'upgrade-insecure-requests': '', // Value-less directive
          },
          reportUri: 'https://report.example.com/csp',
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

### Verify

```bash
FRONTMCP_DEPLOYMENT_MODE=distributed frontmcp build --target distributed
node dist/distributed/main.js

# Verify all headers
curl -sI http://localhost:3000/healthz

# Expected headers:
# Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.example.com; ...
# Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
# X-Content-Type-Options: nosniff
# X-Frame-Options: DENY
```

## What This Demonstrates

- Full CSP enforcement with multiple directive types including value-less directives
- HSTS with preload and includeSubDomains for HTTPS enforcement
- X-Frame-Options DENY for clickjacking protection
- Custom headers for additional security controls

## Related

- See `configure-security-headers` for the full configuration reference
- See `csp-report-only` for testing CSP before enforcement
- See `distributed-ha` for the HA architecture reference
