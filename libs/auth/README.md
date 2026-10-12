# @frontmcp/auth

Authentication and authorization for FrontMCP servers: the five `auth` modes, OAuth 2.1 sign-in with FrontMCP as its own authorization server or in front of your identity provider, JSON Web Token (JWT) and session checks, access rules on tools, and the built-in sign-in pages. `@frontmcp/sdk` depends on this package, so a FrontMCP server already has it, and you configure it through `@FrontMcp({ auth })`. Install it yourself only to import something the SDK doesn't re-export, like `escapeHtml` for a custom sign-in page or `AuthorityDeniedError`.

[![npm](https://img.shields.io/npm/v/@frontmcp/auth.svg)](https://www.npmjs.com/package/@frontmcp/auth) [![License](https://img.shields.io/npm/l/@frontmcp/auth.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Install

A FrontMCP server doesn't need this step: `@frontmcp/sdk` installs `@frontmcp/auth`. To import from it directly:

```bash
npm install @frontmcp/auth
```

Use the same version as `@frontmcp/sdk`. It needs Node.js 24 or later.

| Peer dependency            | Required | What it's for                                                                                                  |
| -------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `@frontmcp/lazy-zod`       | Yes      | The option schemas. `@frontmcp/sdk` already brings it; it needs `zod` 4.                                       |
| `ioredis`                  | No       | Redis-backed stores: `tokenStorage: { redis }` in `local` and `remote` modes, `RedisSessionStore`, and others. |
| `@vercel/kv`               | No       | `VercelKvSessionStore`.                                                                                        |
| `@frontmcp/storage-sqlite` | No       | `tokenStorage: { sqlite }`.                                                                                    |

## Usage

Set `auth` on `@FrontMcp`; its schema comes from this package. Here users sign in at your identity provider, and FrontMCP issues the tokens MCP clients send:

```ts
import { FrontMcp } from '@frontmcp/sdk';

import { DeskApp } from './desk.app';

@FrontMcp({
  info: { name: 'desk', version: '1.0.0' },
  apps: [DeskApp],
  auth: {
    mode: 'remote',
    provider: 'https://idp.example.com',
    clientId: 'desk-mcp',
    clientSecret: process.env.IDP_CLIENT_SECRET,
    scopes: ['openid', 'profile', 'email'],
  },
})
export default class Server {}
```

In production, set `JWT_SECRET`: FrontMCP signs its tokens with it. [Remote and proxied auth](https://frontmcp.dev/reference/auth/remote) lists every option, and the callback URL to register at your provider. `mode` is one of:

| `mode`          | Who gets in                                                    |
| --------------- | -------------------------------------------------------------- |
| `'public'`      | Everyone. The default.                                         |
| `'static'`      | Requests that send one of your keys.                           |
| `'transparent'` | Requests with a valid JWT signed by your identity provider.    |
| `'local'`       | Users who sign in on FrontMCP's own page.                      |
| `'remote'`      | Users who sign in at your identity provider, through FrontMCP. |

### Importing from the package directly

In `local` mode, `login.render` replaces the sign-in page. FrontMCP doesn't escape what you print, so pass every value through `escapeHtml`:

```ts
import { escapeHtml } from '@frontmcp/auth';
import { FrontMcp } from '@frontmcp/sdk';

import { DeskApp } from './desk.app';

@FrontMcp({
  info: { name: 'desk', version: '1.0.0' },
  apps: [DeskApp],
  auth: {
    mode: 'local',
    login: {
      fields: { deskKey: { type: 'password', label: 'Desk key', required: true } },
      render: (ctx) => `<!doctype html>
<html lang="en">
  <body>
    <p>${escapeHtml(ctx.clientName)} wants to connect to your desk.</p>
    ${ctx.error ? `<p role="alert">${escapeHtml(ctx.error)}</p>` : ''}
    <form method="POST" action="${escapeHtml(ctx.callbackPath)}">
      <input type="hidden" name="pending_auth_id" value="${escapeHtml(ctx.pendingAuthId)}">
      <label>Desk key <input type="password" name="deskKey" required></label>
      <button>Sign in</button>
    </form>
  </body>
</html>`,
    },
    authenticate: async ({ fields }) =>
      fields.deskKey === process.env.DESK_KEY
        ? { ok: true, sub: 'operator' }
        : { ok: false, message: 'Unknown desk key' },
  },
})
export default class Server {}
```

## What's in it

- **Auth modes**: `authOptionsSchema` and the option types of each mode. See [Auth modes](https://frontmcp.dev/reference/auth/modes).
- **Local mode**: FrontMCP as an OAuth 2.1 authorization server, with PKCE (Proof Key for Code Exchange), dynamic client registration and refresh tokens. See [Local auth](https://frontmcp.dev/reference/auth/local).
- **Remote mode**: users sign in at your identity provider, and FrontMCP issues the tokens. See [Remote and proxied auth](https://frontmcp.dev/reference/auth/remote).
- **Upstream providers**: several OAuth providers linked in one sign-in. See [Upstream providers](https://frontmcp.dev/reference/auth/upstream-providers).
- **Token checks**: JWT verification against a JSON Web Key Set (JWKS), and audience and scope checks (`JwksService`, `validateAudience`). See [Tokens and sessions](https://frontmcp.dev/reference/auth/tokens).
- **CIMD (Client ID Metadata Documents)**: clients whose `client_id` is the URL of a metadata document (`CimdService`). See [Client ID metadata](https://frontmcp.dev/reference/auth/cimd).
- **Authorities**: rules on tools, resources, prompts, skills and agents, from roles, permissions, token claims, the call's arguments or your own code (`AuthorityDeniedError`). See [Authorities](https://frontmcp.dev/reference/auth/authorities).
- **Credential vault**: per-user credentials that tools read with `this.credentials`, and that users can add to mid-session. See [Progressive auth](https://frontmcp.dev/reference/auth/progressive).
- **Sign-in pages**: the built-in sign-in, consent and error pages, and `escapeHtml`, `buildLoginPage` and `baseLayout` for your own. See [Custom login UI](https://frontmcp.dev/reference/auth/login-ui).
- **Storage**: memory, Redis, Vercel KV and SQLite stores for sessions, authorization codes and tokens, and encrypted storage for secrets (`EncryptedTypedStorage`, `TokenVault`). See [Local auth storage](https://frontmcp.dev/reference/auth/local#storage).

## Docs

- [Authentication and authorization](https://frontmcp.dev/reference/auth): an overview, and which page covers which task
- [Auth in production](https://frontmcp.dev/reference/auth/production): secrets, HTTPS, token checks and several instances
- [`this.auth`](https://frontmcp.dev/reference/sdk/auth): who is calling, from inside a tool
- [Authenticating clients](https://frontmcp.dev/learn/authenticating-clients) and [Authorizing calls](https://frontmcp.dev/learn/authorizing-calls): step-by-step guides
- [Testing authentication](https://frontmcp.dev/reference/testing/auth)

## Related packages

- [`@frontmcp/sdk`](https://www.npmjs.com/package/@frontmcp/sdk): the framework. It runs this package and re-exports its option types.
- [`@frontmcp/utils`](https://www.npmjs.com/package/@frontmcp/utils): the crypto (PKCE, encryption, key derivation) and storage adapters this package builds on.
- [`@frontmcp/ui`](https://www.npmjs.com/package/@frontmcp/ui): `@frontmcp/ui/auth`, for React sign-in pages set with `auth.ui`.
- [`@frontmcp/testing`](https://www.npmjs.com/package/@frontmcp/testing): token factories and mock OAuth servers for tests.

## Contributing

Source: [`libs/auth`](https://github.com/agentfront/frontmcp/tree/main/libs/auth). Issues and pull requests are welcome; see [CONTRIBUTING.md](https://github.com/agentfront/frontmcp/blob/main/CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](https://github.com/agentfront/frontmcp/blob/main/LICENSE).
