---
name: ref-security-and-filtering
reference: openapi-adapter
level: intermediate
description: 'Demonstrates configuring $ref / spec-URL resolution security to prevent SSRF attacks (GHSA-65h7-9wrw-629c) and filtering which API operations become MCP tools.'
tags: [development, openapi, adapters, security, ssrf, filtering]
features:
  - 'Secure defaults: external `$ref` resolution off, spec-URL redirects not followed, internal/private targets blocked (DNS-resolved) — on `mcp-from-openapi` >= 2.5.0'
  - 'Opting back into external refs with `allowedProtocols`, and restricting the spec URL + `$ref`s with `allowedHosts`'
  - 'Using `allowInternalIPs` for trusted internal/local targets (governs the spec URL and `$ref`s)'
  - 'Filtering operations with `includeOperations`, `excludeOperations`, and `filterFn`'
  - 'Combining security hardening with operation filtering for a production-ready setup'
---

# $ref Security and Operation Filtering

Demonstrates configuring $ref / spec-URL resolution security to prevent SSRF attacks (GHSA-65h7-9wrw-629c) and filtering which API operations become MCP tools.

## Code

```typescript
// src/server.ts
import { FrontMcp, App } from '@frontmcp/sdk';
import { OpenapiAdapter } from '@frontmcp/adapters';

@App({
  name: 'secure-app',
  adapters: [
    // Production-hardened: ENABLE external $refs but restrict to trusted hosts.
    // (External refs are OFF by default in FrontMCP; you must opt in.)
    // NOTE: allowedHosts now also gates the spec URL itself, so the spec host
    // (api.partner.com) must be in the list. Internal targets stay blocked and
    // hostnames are DNS-resolved (mcp-from-openapi >= 2.5.0).
    OpenapiAdapter.init({
      name: 'partner-api',
      url: 'https://api.partner.com/openapi.json',
      baseUrl: 'https://api.partner.com',
      loadOptions: {
        refResolution: {
          allowedProtocols: ['http', 'https'], // opt back into external refs
          // Only allow the spec URL + $refs pointing to the partner's own hosts
          allowedHosts: ['schemas.partner.com', 'api.partner.com'],
          // Block additional hosts known to be problematic
          blockedHosts: ['internal.partner.com'],
        },
      },
      generateOptions: {
        // Only expose read operations to MCP clients
        filterFn: (op) => op.method === 'get',
        // Skip deprecated endpoints
        includeDeprecated: false,
      },
      staticAuth: {
        apiKey: process.env.PARTNER_API_KEY!,
      },
    }),

    // Internal API: allow internal targets (trusted environment only).
    // allowInternalIPs re-allows BOTH the spec-URL fetch to 10.0.0.5 AND $refs.
    OpenapiAdapter.init({
      name: 'internal-api',
      url: 'http://10.0.0.5:8080/openapi.json',
      baseUrl: 'http://10.0.0.5:8080',
      loadOptions: {
        refResolution: {
          // Allow internal IPs since this is a trusted internal service
          allowInternalIPs: true,
        },
      },
      generateOptions: {
        // Only include specific safe operations
        includeOperations: ['getStatus', 'listMetrics', 'getConfig'],
      },
    }),

    // Maximum lockdown: no external $refs at all. This matches the FrontMCP
    // default (external refs off) — shown explicitly for clarity.
    OpenapiAdapter.init({
      name: 'sandbox-api',
      url: 'https://sandbox.example.com/openapi.json',
      baseUrl: 'https://sandbox.example.com',
      loadOptions: {
        refResolution: {
          // Block ALL external $ref resolution — only local #/ pointers work
          allowedProtocols: [],
        },
      },
      generateOptions: {
        // Exclude admin and dangerous operations
        excludeOperations: ['deleteAll', 'resetDatabase', 'adminPanel'],
        // Only include billing-related paths
        filterFn: (op) => op.path.startsWith('/billing') || op.path.startsWith('/invoices'),
      },
    }),
  ],
})
class SecureApp {}

@FrontMcp({
  info: { name: 'secure-server', version: '1.0.0' },
  apps: [SecureApp],
  http: { port: 3000 },
})
class MyServer {}
```

## What This Demonstrates

- Secure defaults: external `$ref` resolution off, spec-URL redirects not followed, internal/private targets blocked (DNS-resolved) — on `mcp-from-openapi` >= 2.5.0
- Opting back into external refs with `allowedProtocols`, and restricting the spec URL + `$ref`s with `allowedHosts`
- Using `allowInternalIPs` for trusted internal/local targets (governs the spec URL and `$ref`s)
- Filtering operations with `includeOperations`, `excludeOperations`, and `filterFn`
- Combining security hardening with operation filtering for a production-ready setup

## Related

- See `openapi-adapter` for all `refResolution` options and the full blocked IP list
- See `official-adapters` for the adapter vs plugin comparison
