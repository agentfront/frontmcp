---
name: local-dcr-control
reference: configure-auth-modes
level: intermediate
description: 'Lock down the built-in Dynamic Client Registration endpoint with the auth.dcr control surface: disable open registration, allowlist redirect URIs and client ids, and seed a pre-registered trusted client.'
tags: [config, auth, local, dcr, dynamic-client-registration, security, auth-modes]
features:
  - 'Setting `dcr.enabled: false` so `POST /oauth/register` returns 404 and `registration_endpoint` is dropped from AS metadata'
  - 'Constraining `dcr.allowedRedirectUris` (exact or `*` glob) so unlisted redirect URIs are rejected at both register and authorize'
  - 'Constraining `dcr.allowedClientIds` so only known client ids may use `/oauth/authorize`'
  - 'Seeding `dcr.clients` so a trusted client is accepted without any DCR round-trip'
---

# Lock Down Dynamic Client Registration

Lock down the built-in Dynamic Client Registration endpoint with the auth.dcr control surface: disable open registration, allowlist redirect URIs and client ids, and seed a pre-registered trusted client.

## Code

```typescript
// src/server.ts
// JWT_SECRET still signs the HS256 tokens — set a stable value.
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  info: { name: 'internal-api', version: '1.0.0' },
  auth: {
    mode: 'local',
    dcr: {
      // Close open self-registration entirely (regardless of NODE_ENV).
      // /oauth/register now responds 404 and AS metadata omits registration_endpoint.
      enabled: false,
      // Only these redirect URIs are ever accepted (exact match or simple `*` glob),
      // enforced at BOTH /oauth/register and /oauth/authorize.
      allowedRedirectUris: ['https://app.example.com/callback', 'http://localhost:*/callback'],
      // Only these client ids may use /oauth/authorize.
      allowedClientIds: ['dashboard'],
      // Seed the trusted client so authorize accepts it WITHOUT a DCR round-trip.
      clients: [
        {
          clientId: 'dashboard',
          redirectUris: ['https://app.example.com/callback'],
          clientName: 'Internal Dashboard',
        },
      ],
    },
  },
})
class Server {}
```

To keep DCR open but authenticated instead of closed, drop `enabled: false` and set
`initialAccessToken` — then `POST /oauth/register` requires an
`Authorization: Bearer <token>` header that matches it (constant-time compared), and
requests without it get `401 invalid_token`.

## What This Demonstrates

- Setting `dcr.enabled: false` so `POST /oauth/register` returns 404 and `registration_endpoint` is dropped from AS metadata
- Constraining `dcr.allowedRedirectUris` (exact or `*` glob) so unlisted redirect URIs are rejected at both register and authorize
- Constraining `dcr.allowedClientIds` so only known client ids may use `/oauth/authorize`
- Seeding `dcr.clients` so a trusted client is accepted without any DCR round-trip

## Related

- See `configure-auth-modes` for the full local-mode option reference, including the `dcr` block
- See `local-single-operator` for the smallest single-operator local-mode configuration
