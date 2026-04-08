---
name: ref-security-and-filtering
reference: openapi-adapter
level: intermediate
description: 'Demonstrates configuring $ref resolution security to prevent SSRF attacks and filtering which API operations become MCP tools.'
tags: [development, openapi, adapters, security, ssrf, filtering]
features:
  - 'Configuring `refResolution` to restrict which hosts and protocols are allowed for external `$ref` pointers'
  - 'Using `allowedHosts` to restrict $refs to trusted schema servers'
  - 'Using `allowedProtocols` to enable or disable file://, http://, https://, and other protocols'
  - 'Filtering operations with `includeOperations`, `excludeOperations`, and `filterFn`'
  - 'Combining security hardening with operation filtering for a production-ready setup'
---

# $ref Security and Operation Filtering

Demonstrates configuring $ref resolution security to prevent SSRF attacks and filtering which API operations become MCP tools.

## Code

```typescript
// src/server.ts
import { FrontMcp, App } from '@frontmcp/sdk';
import { OpenapiAdapter } from '@frontmcp/adapters';

@App({
  name: 'secure-app',
  adapters: [
    // Production-hardened: restrict $refs to trusted hosts + filter operations
    OpenapiAdapter.init({
      name: 'partner-api',
      url: 'https://api.partner.com/openapi.json',
      baseUrl: 'https://api.partner.com',
      loadOptions: {
        refResolution: {
          // Only allow $refs pointing to the partner's own schema server
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

    // Internal API: allow internal IPs but lock down to specific operations
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

    // Maximum lockdown: no external $refs at all
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

- Configuring `refResolution` to restrict which hosts and protocols are allowed for external `$ref` pointers
- Using `allowedHosts` to restrict $refs to trusted schema servers
- Using `allowedProtocols` to enable or disable file://, http://, https://, and other protocols
- Filtering operations with `includeOperations`, `excludeOperations`, and `filterFn`
- Combining security hardening with operation filtering for a production-ready setup

## Related

- See `openapi-adapter` for all `refResolution` options and the full blocked IP list
- See `official-adapters` for the adapter vs plugin comparison
