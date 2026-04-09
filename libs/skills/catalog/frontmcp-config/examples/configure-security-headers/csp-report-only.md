---
name: csp-report-only
reference: configure-security-headers
level: basic
description: Test CSP policies in report-only mode to identify violations before enforcement
tags: [config, csp, security, report-only, headers]
features:
  - Enabling CSP in report-only mode with reportUri for violation monitoring
  - Using the object-format directives in frontmcp.config
  - Verifying report-only header is emitted instead of enforcement header
---

# CSP Report-Only Mode

Test your Content Security Policy by running it in report-only mode first. Violations are logged to a reporting endpoint without blocking any content.

## Code

```typescript
// frontmcp.config.ts
import { defineConfig } from '@frontmcp/cli';

export default defineConfig({
  name: 'csp-test-server',
  deployments: [
    {
      target: 'node',
      server: {
        csp: {
          enabled: true,
          reportOnly: true, // Key: report violations, don't block
          directives: {
            'default-src': "'self'",
            'script-src': "'self'",
            'style-src': "'self'",
            'img-src': "'self' data:",
            'connect-src': "'self'",
          },
          reportUri: 'https://report.example.com/csp-violations',
        },
      },
    },
  ],
});
```

### Verify

```bash
frontmcp build --target node && node dist/node/main.js

# Check which header is emitted
curl -sI http://localhost:3000/healthz | grep -i content-security-policy
# Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self'; ...

# Once violations are resolved, switch to enforcement:
# reportOnly: false
```

## What This Demonstrates

- `reportOnly: true` emits `Content-Security-Policy-Report-Only` instead of `Content-Security-Policy`
- The `reportUri` receives JSON violation reports from browsers
- You can monitor violations in production before enforcing the policy

## Related

- See `configure-security-headers` for the full CSP configuration reference
- See `full-production-headers` for the enforcement version with all security headers
