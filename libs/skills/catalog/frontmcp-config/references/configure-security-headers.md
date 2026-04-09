---
name: configure-security-headers
description: Configure CSP, HSTS, X-Frame-Options, and X-Content-Type-Options via frontmcp.config server settings
---

# Configure Security Headers

Set Content Security Policy (CSP), HSTS, and other security headers on every HTTP response. Configure them in `frontmcp.config` per deployment target — the build adapter injects them as environment variables that the built-in middleware reads at runtime.

## When to Use This Skill

### Must Use

- Deploying to production and need CSP headers to prevent XSS
- Required to send HSTS headers for HTTPS enforcement
- Compliance requires specific X-Frame-Options or X-Content-Type-Options values

### Recommended

- Any production deployment behind HTTPS
- Testing CSP policies in report-only mode before enforcement

### Skip When

- Local development only (security headers are unnecessary on localhost)
- Browser target (no HTTP server to set headers on)
- You manage headers via NGINX/CDN instead of the application

> **Decision:** Use this skill when the FrontMCP server must emit its own security headers. Skip if a reverse proxy handles them.

## Prerequisites

- `@frontmcp/cli` installed
- A `frontmcp.config.ts` or `.json` file (see `configure-deployment-targets`)

## Step 1: Add CSP to Your Config

CSP directives are specified as a record (object) mapping directive names to values:

```typescript
// frontmcp.config.ts
import { defineConfig } from '@frontmcp/cli';

export default defineConfig({
  name: 'my-server',
  deployments: [
    {
      target: 'node',
      server: {
        csp: {
          enabled: true,
          directives: {
            'default-src': "'self'",
            'script-src': "'self' https://cdn.example.com",
            'style-src': "'self' 'unsafe-inline'",
            'img-src': '* data:',
            'upgrade-insecure-requests': '', // value-less directive
          },
        },
      },
    },
  ],
});
```

## Step 2: Add Security Headers

```typescript
server: {
  headers: {
    hsts: 'max-age=31536000; includeSubDomains; preload',
    contentTypeOptions: 'nosniff',  // default, can omit
    frameOptions: 'DENY',           // default, can omit
  },
}
```

## Step 3: Build and Verify

```bash
frontmcp build --target node
node dist/node/main.js

# Verify headers
curl -I http://localhost:3000/healthz
# Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.example.com; ...
# Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
# X-Content-Type-Options: nosniff
# X-Frame-Options: DENY
```

## Configuration Reference

### CSP Options (`server.csp`)

| Field        | Type                                 | Default | Description                               |
| ------------ | ------------------------------------ | ------- | ----------------------------------------- |
| `enabled`    | boolean                              | false   | Enable CSP headers                        |
| `directives` | `Record<string, string \| string[]>` | ---     | Directive-to-value map                    |
| `reportUri`  | string                               | ---     | URI for violation reports                 |
| `reportOnly` | boolean                              | false   | Use `Content-Security-Policy-Report-Only` |

### Security Headers (`server.headers`)

| Field                | Type                    | Default   | Header                      |
| -------------------- | ----------------------- | --------- | --------------------------- |
| `hsts`               | `string \| false`       | ---       | `Strict-Transport-Security` |
| `contentTypeOptions` | `string \| false`       | `nosniff` | `X-Content-Type-Options`    |
| `frameOptions`       | `string \| false`       | `DENY`    | `X-Frame-Options`           |
| `custom`             | `Record<string,string>` | ---       | Any custom headers          |

Set any of the first three fields to `false` to explicitly disable that header.

### Value-Less CSP Directives

Directives like `upgrade-insecure-requests` and `block-all-mixed-content` have no value. Set them with an empty string:

```typescript
directives: {
  'upgrade-insecure-requests': '',
  'block-all-mixed-content': '',
}
```

### Report-Only Mode

Test CSP rules without blocking content:

```typescript
csp: {
  enabled: true,
  directives: { 'default-src': "'self'" },
  reportUri: 'https://report.example.com/csp',
  reportOnly: true,  // violations reported, not blocked
}
```

### Environment Variables

The build adapter converts config to these env vars (can also be overridden at runtime):

| Variable                        | Config Path                          |
| ------------------------------- | ------------------------------------ |
| `FRONTMCP_CSP_ENABLED`          | `server.csp.enabled`                 |
| `FRONTMCP_CSP_DIRECTIVES`       | `server.csp.directives` (serialized) |
| `FRONTMCP_CSP_REPORT_URI`       | `server.csp.reportUri`               |
| `FRONTMCP_CSP_REPORT_ONLY`      | `server.csp.reportOnly`              |
| `FRONTMCP_HSTS`                 | `server.headers.hsts`                |
| `FRONTMCP_CONTENT_TYPE_OPTIONS` | `server.headers.contentTypeOptions`  |
| `FRONTMCP_FRAME_OPTIONS`        | `server.headers.frameOptions`        |

## Common Patterns

| Pattern               | Correct                           | Incorrect                       | Why                                                  |
| --------------------- | --------------------------------- | ------------------------------- | ---------------------------------------------------- |
| CSP directives format | `{ 'default-src': "'self'" }`     | `"default-src 'self'"` (string) | Config schema expects a record, not a string         |
| Value-less directives | `'upgrade-insecure-requests': ''` | Omitting them                   | Empty string preserves the directive in output       |
| Testing CSP           | Start with `reportOnly: true`     | Enforce immediately             | Report-only lets you fix violations without blocking |
| HSTS in dev           | Omit `hsts` in dev config         | `max-age=31536000` in dev       | HSTS persists in browser cache, hard to undo locally |

## Verification Checklist

### Configuration

- [ ] `csp.enabled: true` in production deployment
- [ ] `directives` covers at least `default-src`
- [ ] `reportUri` set for CSP violation monitoring
- [ ] `hsts` set with appropriate `max-age` for production

### Runtime

- [ ] `curl -I` shows `Content-Security-Policy` header
- [ ] `X-Content-Type-Options: nosniff` present
- [ ] `X-Frame-Options: DENY` present (or `SAMEORIGIN` if iframes needed)
- [ ] Report-only mode tested before enforcement

## Troubleshooting

| Problem                               | Cause                                         | Solution                                                |
| ------------------------------------- | --------------------------------------------- | ------------------------------------------------------- |
| CSP header missing                    | `csp.enabled` not set or build not rebuilt    | Set `enabled: true` and rebuild                         |
| Assets blocked by CSP                 | Missing directive for CDN/external source     | Add the source to the appropriate directive             |
| Browser forced to HTTPS unexpectedly  | HSTS set before HTTPS configured              | Clear browser HSTS cache or use `max-age=0` temporarily |
| `Invalid frontmcp.config: directives` | Using string instead of record for directives | Change to `{ 'directive-name': 'value' }` object format |

## Examples

| Example                                                                                        | Level        | Description                                                                                                            |
| ---------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| [`csp-report-only`](../examples/configure-security-headers/csp-report-only.md)                 | Basic        | Test CSP policies in report-only mode to identify violations before enforcement                                        |
| [`full-production-headers`](../examples/configure-security-headers/full-production-headers.md) | Intermediate | Complete security headers configuration for production with CSP enforcement, HSTS preload, and clickjacking protection |

> See all examples in [`examples/configure-security-headers/`](../examples/configure-security-headers/)

## Reference

- [Documentation](https://docs.agentfront.dev/frontmcp/deployment/security-headers)
- Related skills: `configure-deployment-targets`, `configure-http`, `frontmcp-deployment`
