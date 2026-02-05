# @frontmcp/auth

Authentication, session management, and credential vault for FrontMCP servers.

[![NPM](https://img.shields.io/npm/v/@frontmcp/auth.svg)](https://www.npmjs.com/package/@frontmcp/auth)

## Install

```bash
npm install @frontmcp/auth
```

> Typically consumed via `@frontmcp/sdk` — direct installation is only needed for advanced use cases.

## Features

- **Remote OAuth** — delegate authentication to an external IdP with optional DCR ([docs][docs-remote])
- **Local OAuth** — built-in token issuance with configurable sign keys ([docs][docs-local])
- **JWKS validation** — JSON Web Key Set discovery and token verification ([docs][docs-jwks])
- **OAuth stores** — session, token, and authorization code persistence (memory, Redis, Vercel KV) ([docs][docs-stores])
- **Credential vault** — encrypted storage for secrets and API keys ([docs][docs-vault])
- **PKCE** — Proof Key for Code Exchange (RFC 7636) built on `@frontmcp/utils` crypto ([docs][docs-pkce])
- **CIMD** — Client Instance Machine Detection for session continuity ([docs][docs-cimd])
- **Auth UI templates** — consent, login, and error pages ([docs][docs-ui])
- **Audience validation** — per-app audience and scope enforcement ([docs][docs-audience])
- **Token vault** — secure token exchange and refresh management ([docs][docs-token-vault])

## Quick Example

```ts
import { FrontMcp, App } from '@frontmcp/sdk';

@FrontMcp({
  info: { name: 'Secure Server', version: '1.0.0' },
  apps: [MyApp],
  auth: {
    type: 'remote',
    name: 'my-idp',
    baseUrl: 'https://idp.example.com',
  },
})
export default class Server {}
```

> Full guide: [Authentication Overview][docs-overview]

## Docs

| Topic             | Link                                           |
| ----------------- | ---------------------------------------------- |
| Overview          | [Authentication Overview][docs-overview]       |
| Remote OAuth      | [Remote OAuth][docs-remote]                    |
| Local OAuth       | [Local OAuth][docs-local]                      |
| JWKS              | [JWKS Validation][docs-jwks]                   |
| Session stores    | [Session Stores][docs-stores]                  |
| Credential vault  | [Credential Vault][docs-vault]                 |
| PKCE              | [PKCE][docs-pkce]                              |
| CIMD              | [Client Instance Machine Detection][docs-cimd] |
| Auth UI           | [Auth UI Templates][docs-ui]                   |
| Audience & scopes | [Audience Validation][docs-audience]           |
| Token vault       | [Token Vault][docs-token-vault]                |

## Related Packages

- [`@frontmcp/sdk`](../sdk) — core framework (imports auth internally)
- [`@frontmcp/utils`](../utils) — crypto primitives used by PKCE and vault
- [`@frontmcp/ui`](../ui) — consent and login page components

## License

Apache-2.0 — see [LICENSE](../../LICENSE).

<!-- links -->

[docs-overview]: https://docs.agentfront.dev/frontmcp/authentication/overview
[docs-remote]: https://docs.agentfront.dev/frontmcp/authentication/remote
[docs-local]: https://docs.agentfront.dev/frontmcp/authentication/local
[docs-jwks]: https://docs.agentfront.dev/frontmcp/authentication/jwks
[docs-stores]: https://docs.agentfront.dev/frontmcp/authentication/session-stores
[docs-vault]: https://docs.agentfront.dev/frontmcp/authentication/credential-vault
[docs-pkce]: https://docs.agentfront.dev/frontmcp/authentication/pkce
[docs-cimd]: https://docs.agentfront.dev/frontmcp/authentication/cimd
[docs-ui]: https://docs.agentfront.dev/frontmcp/authentication/auth-ui
[docs-audience]: https://docs.agentfront.dev/frontmcp/authentication/audience
[docs-token-vault]: https://docs.agentfront.dev/frontmcp/authentication/token-vault
