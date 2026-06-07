---
name: configure-http
description: Configure HTTP server port, CORS policy, unix sockets, entry path prefix, request body limits, and custom HTTP routes
---

# Configuring HTTP Options

Configure the HTTP server — port, CORS policy, unix sockets, entry path prefix, request body limits, and first-class custom HTTP routes.

## When to Use This Skill

### Must Use

- Changing the default HTTP port or binding to a specific network interface
- Enabling or restricting CORS for a frontend application that calls the MCP server
- Binding to a unix socket for local daemon or process-manager integrations
- Raising or tightening the request body limit (default `'4mb'`) for tools that
  accept base64-encoded blobs (PDFs, DOCXes, large HTML payloads)
- Adding a custom HTTP route (download endpoint, webhook, health-beyond-`/health`)
  on the same listener as the MCP endpoint via `http.routes`

### Recommended

- Mounting the MCP server under a URL prefix behind a reverse proxy
- Setting a dynamic port from an environment variable for container deployments
- Fine-tuning CORS preflight caching for performance-sensitive frontends
- Tightening `bodyLimit` on public-facing deployments to bound per-request
  memory

### Skip When

- Using stdio transport only with no HTTP listener -- no HTTP options apply
- Only need rate limiting or IP filtering without changing HTTP binding -- use `configure-throttle`
- Need to configure TLS/HTTPS termination -- handle at the reverse proxy or load balancer level, not in FrontMCP

> **Decision:** Use this skill when you need to customize how the HTTP listener binds (port, socket, prefix) or how it handles CORS; skip if the default port 3000 with permissive CORS is sufficient.

## HttpOptionsInput

```typescript
@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  http: {
    port: 3000, // default: 3000
    entryPath: '', // default: '' (root)
    socketPath: undefined, // unix socket path (overrides port)
    cors: {
      // default: permissive (all origins)
      origin: ['https://myapp.com'],
      credentials: true,
      maxAge: 86400,
    },
    bodyLimit: '4mb', // default: '4mb' — body-parser-compatible string or bytes (number)
    urlencodedLimit: undefined, // default: falls back to bodyLimit
    routes: [
      // First-class custom HTTP routes (see "Custom HTTP Routes" below)
      {
        method: 'GET',
        path: '/download/:id',
        handler: (req, res) => {
          /* ... */
        },
      },
    ],
  },
})
class Server {}
```

## Port Configuration

```typescript
// Default: port 3000
http: {
  port: 3000;
}

// Use environment variable
http: {
  port: Number(process.env.PORT) || 3000;
}

// Random port (useful for testing)
http: {
  port: 0;
}
```

## CORS Configuration

### Permissive (Default)

When `cors` is not specified, the server allows all origins without credentials:

```typescript
// All origins allowed (default behavior)
http: {
}
```

### Restrict to Specific Origins

```typescript
http: {
  cors: {
    origin: ['https://myapp.com', 'https://staging.myapp.com'],
    credentials: true,
    maxAge: 86400,  // Cache preflight for 24 hours
  },
}
```

### Disable CORS Entirely

```typescript
http: {
  cors: false,  // No CORS headers at all
}
```

### Dynamic Origin

The `origin` callback uses Node-style `(origin, callback)` signature so origin checks
can be async (e.g., look up the allowlist from a database):

```typescript
http: {
  cors: {
    origin: (origin, callback) => {
      // origin is `string | undefined` (undefined for same-origin / non-browser requests)
      const allowed = !!origin && origin.endsWith('.myapp.com');
      callback(null, allowed);
    },
    credentials: true,
  },
}
```

### CORS Fields

| Field         | Type                                        | Default      | Description                        |
| ------------- | ------------------------------------------- | ------------ | ---------------------------------- |
| `origin`      | `boolean \| string \| string[] \| function` | `true` (all) | Allowed origins                    |
| `credentials` | `boolean`                                   | `false`      | Allow cookies/auth headers         |
| `maxAge`      | `number`                                    | —            | Preflight cache duration (seconds) |

## Request Body Limits

FrontMCP's Express host applies a default body limit of `'4mb'` to both
`express.json()` and `express.urlencoded()`. This lifts body-parser's silent
100KB default, which previously rejected base64-encoded blobs (PDFs, DOCXes,
large HTML inputs) with HTTP 413 before they reached MCP tool handlers
(issue #410).

```typescript
http: {
  bodyLimit: '500kb',       // tighten for public-facing deployments
  urlencodedLimit: '100kb', // optional — falls back to bodyLimit when omitted
}
```

| Option            | Type               | Default                   | Notes                                                                  |
| ----------------- | ------------------ | ------------------------- | ---------------------------------------------------------------------- |
| `bodyLimit`       | `number \| string` | `'4mb'`                   | Bytes (number) or body-parser string (`'4mb'`, `'500kb'`, `'2gb'`, …). |
| `urlencodedLimit` | `number \| string` | falls back to `bodyLimit` | Independent override for `application/x-www-form-urlencoded` bodies.   |

Requests exceeding the configured limit receive a structured JSON-RPC 413
response — never an Express HTML error page:

```json
{
  "jsonrpc": "2.0",
  "id": null,
  "error": {
    "code": -32600,
    "message": "Payload Too Large",
    "data": { "limit": 102400, "length": 204800 }
  }
}
```

> **Security trade-off.** Body-parser buffers the full request body in memory
> before parsing, so raising `bodyLimit` scales per-request memory with
> concurrency. Deployments exposed to untrusted networks should set an
> explicit lower bound sized for the largest legitimate payload. The
> 100KB → 4MB default change is a liberalization (every request that
> succeeded before still succeeds), but the implicit DoS guard is gone
> unless you set the option yourself.

Custom `hostFactory` users build their own Express app and are **not
affected** by `bodyLimit`/`urlencodedLimit` — those options are consumed only
by the built-in `ExpressHostAdapter`. Custom-host deployments must configure
their own body limits.

## Custom HTTP Routes

`http.routes` mounts first-class custom HTTP handlers on the **same listener**
as the MCP JSON-RPC endpoint. Use them for byte delivery (file/stream/binary
downloads), webhooks, health probes beyond `/health`, or any non-JSON-RPC
surface — the MCP channel cannot serve those.

```typescript
import type { ServerRequest, ServerResponse } from '@frontmcp/sdk';

http: {
  routes: [
    // Public route (default) — no auth.
    {
      method: 'GET',
      path: '/download/:id',
      handler: (req: ServerRequest, res: ServerResponse) => {
        res.setHeader('Content-Type', 'application/pdf'); // see Content-Type note
        res.status(200).send(loadPdfBytes(req.params.id));
      },
    },
    // Auth-gated route — runs the MCP `session:verify` flow first.
    {
      method: 'POST',
      path: '/webhooks/billing',
      auth: true,
      handler: (req: ServerRequest, res: ServerResponse) => {
        // req.authSession is populated when auth: true and verification passed
        res.status(202).json({ accepted: true, user: req.authSession?.user?.sub });
      },
    },
  ],
}
```

| Field     | Type                   | Default          | Description                                                              |
| --------- | ---------------------- | ---------------- | ------------------------------------------------------------------------ |
| `method`  | `HttpMethod`           | —                | `'GET' \| 'POST' \| 'PUT' \| 'PATCH' \| 'DELETE' \| 'OPTIONS' \| 'HEAD'` |
| `path`    | `string`               | —                | Express-style path (`/files/:id`); must not collide with reserved paths  |
| `handler` | `ServerRequestHandler` | —                | `(req, res, next) => void \| Promise<void>`                              |
| `auth`    | `boolean`              | `false` (public) | When `true`, gate behind the MCP `session:verify` flow                   |

### Handler signature

The handler uses the framework-agnostic `(req, res, next)` signature. Respond
with `res.status(...).json(...)` / `res.send(...)`, or call `next()` to fall
through. `req` and `res` are exported as `ServerRequest` / `ServerResponse`
from `@frontmcp/sdk`, and `ServerRequestHandler` types the handler directly.

Routes share the configured **CORS policy, body limits, and security
middleware** with the MCP endpoint — they ride the same Express app.

### `auth` opt-in

Routes are **public by default**. Set `auth: true` to run the request through
the exact same `session:verify` flow the MCP endpoint uses:

- **Unauthorized** → short-circuits with `401` + a `WWW-Authenticate` header.
- **Forbidden** (valid token, insufficient scope) → `403` + `WWW-Authenticate`.
- **Authorized** → the verified authorization is attached to `req.authSession`
  before your handler runs.

In **public auth mode** (or transparent with `allowAnonymous`), `auth: true`
routes receive an anonymous session and the handler still runs. Under auth
modes with no anonymous fallback (e.g. `local` with `allowDefaultPublic: false`),
unauthenticated requests get the `401`.

### Reserved-path guard

Custom paths that collide with FrontMCP's own surfaces are **rejected at
startup** (fail-fast) — they would otherwise shadow or be shadowed by the MCP
endpoint. Reserved:

- the resolved MCP entry path (and its `/sse` + `/message` siblings) — split-by-app
  scope bases are included (e.g. `/mcp/billing`),
- anything under `/oauth/*` and `/.well-known/*`,
- `/health` and `/metrics`.

```typescript
// ❌ Throws at startup: collides with the MCP entry path when entryPath: '/mcp'
http: { entryPath: '/mcp', routes: [{ method: 'POST', path: '/mcp', handler }] }
```

### Content-Type gotcha

The built-in `ExpressHostAdapter` defaults **every** response to
`application/json; charset=utf-8`. HTML, binary, and streaming handlers MUST
set their own content type **before** sending the body:

```typescript
{
  method: 'GET',
  path: '/report',
  handler: (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); // or res.type('html')
    res.status(200).send('<!doctype html><h1>Report</h1>');
  },
}
```

### Large payloads: prefer a custom route over `@Resource`

> **Decision:** When a tool needs to hand the client a **large** payload, return
> a [`resource_link`](https://docs.agentfront.dev/frontmcp/servers/resources)
> that points at a custom `http.routes` **GET** handler, and serve the bytes
> from that handler (it supports stream/binary delivery). A `@Resource` rides
> the MCP JSON-RPC channel and is **not** out-of-band — large reads block the
> protocol stream and inflate token usage. The custom route delivers bytes on a
> separate HTTP request the client fetches directly.

## Entry Path Prefix

Mount the MCP server under a URL prefix:

```typescript
http: {
  entryPath: '/api/mcp',
}
// Server endpoints become: /api/mcp/sse, /api/mcp/, etc.
```

Useful when running behind a reverse proxy or alongside other services.

## Unix Socket Mode

Bind to a unix socket instead of a TCP port for local-only access:

```typescript
http: {
  socketPath: '/tmp/my-mcp-server.sock',
}
```

- Mutually exclusive with `port` — if `socketPath` is set, `port` is ignored
- Use for local daemons, CLI tools, and process manager integrations
- Combine with `sqlite` for fully local deployments

## Verification

```bash
# Start with custom port
PORT=8080 frontmcp dev

# Test CORS
curl -v -H "Origin: https://myapp.com" http://localhost:8080/

# Test unix socket
curl --unix-socket /tmp/my-mcp-server.sock http://localhost/
```

## Common Patterns

| Pattern               | Correct                                                      | Incorrect                                    | Why                                                                                                               |
| --------------------- | ------------------------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Port from environment | `port: Number(process.env.PORT) \|\| 3000`                   | `port: process.env.PORT`                     | The `port` field expects a number; passing a string causes a silent bind failure                                  |
| CORS with credentials | `cors: { origin: ['https://myapp.com'], credentials: true }` | `cors: { origin: true, credentials: true }`  | Browsers reject `Access-Control-Allow-Origin: *` when credentials are enabled; you must list explicit origins     |
| Unix socket mode      | `socketPath: '/tmp/my-mcp.sock'` with no `port` field        | Setting both `socketPath` and `port`         | When `socketPath` is set, `port` is silently ignored which can cause confusion during debugging                   |
| Entry path prefix     | `entryPath: '/api/mcp'` (no trailing slash)                  | `entryPath: '/api/mcp/'` with trailing slash | Trailing slashes cause double-slash issues in route matching (e.g., `/api/mcp//sse`)                              |
| Disabling CORS        | `cors: false`                                                | Omitting the `cors` field entirely           | Omitting `cors` applies permissive defaults (all origins allowed); set `false` explicitly to send no CORS headers |

## Verification Checklist

### Configuration

- [ ] `http` block is present in the `@FrontMcp` decorator metadata
- [ ] Port value is a number (not a string) and falls within a valid range (0-65535)
- [ ] If `socketPath` is set, `port` is removed or commented out to avoid confusion
- [ ] `entryPath` does not have a trailing slash

### CORS

- [ ] If `credentials: true`, `origin` lists explicit allowed origins (not `true` or `*`)
- [ ] `maxAge` is set to a reasonable value for production (e.g., `86400` for 24 hours)
- [ ] Dynamic origin function handles `undefined` origin (non-browser requests)

### Custom Routes

- [ ] No custom `path` collides with the MCP entry path, `/sse`, `/message`, `/oauth/*`, `/.well-known/*`, `/health`, or `/metrics`
- [ ] HTML/binary/stream handlers call `res.setHeader('Content-Type', ...)` (or `res.type(...)`) before `res.send(...)`
- [ ] `auth: true` is set on any route that must require a verified session
- [ ] Large payloads are served via a custom GET route + `resource_link`, not a `@Resource`

### Runtime

- [ ] Server starts and binds to the expected port or socket path
- [ ] `curl -v -H "Origin: <your-origin>" <url>` returns correct `Access-Control-Allow-Origin`
- [ ] Preflight `OPTIONS` requests return `204` with expected CORS headers
- [ ] Custom routes respond as expected (`curl <url>/<your-route>`)

## Troubleshooting

| Problem                                               | Cause                                                                                                                | Solution                                                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `EADDRINUSE` on startup                               | Another process is already using the configured port                                                                 | Change the port, stop the other process, or use `port: 0` for a random available port                    |
| CORS errors in the browser console                    | Origin not included in the `cors.origin` list or `credentials: true` with wildcard origin                            | Add the frontend origin to the `origin` array and ensure credentials and origin settings are compatible  |
| Unix socket file not created                          | Missing write permissions on the target directory or stale socket file from a previous run                           | Check directory permissions and remove the stale `.sock` file before restarting                          |
| Routes return 404 after setting `entryPath`           | Client is still requesting the root path without the prefix                                                          | Update client base URL to include the entry path (e.g., `http://localhost:3000/api/mcp`)                 |
| Server binds but external clients cannot connect      | Server bound to `localhost` or `127.0.0.1` inside a container                                                        | Set `host: '0.0.0.0'` or use Docker port mapping to expose the container port                            |
| `413 Payload Too Large` with JSON-RPC envelope        | Request body exceeded `bodyLimit` (default `'4mb'`)                                                                  | Raise `http.bodyLimit` to fit the payload, or move large blobs to a separate upload endpoint             |
| Server throws at startup mentioning a "reserved" path | A custom `http.routes` path collides with the MCP entry path, `/oauth/*`, `/.well-known/*`, `/health`, or `/metrics` | Rename the custom route to a non-reserved path                                                           |
| Custom route returns JSON when HTML/bytes expected    | The Express adapter defaults responses to `application/json`                                                         | Set `res.setHeader('Content-Type', ...)` (or `res.type(...)`) in the handler before sending the body     |
| Custom `auth: true` route always returns `401`        | Auth mode has no anonymous fallback and the request carries no valid bearer token                                    | Send a valid `Authorization: Bearer <jwt>`, or use `auth` mode `public`/transparent-anon for open routes |

## Examples

| Example                                                                              | Level        | Description                                                                                                                      |
| ------------------------------------------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| [`cors-restricted-origins`](../examples/configure-http/cors-restricted-origins.md)   | Basic        | Configure CORS to allow only specific frontend origins with credentials.                                                         |
| [`custom-http-routes`](../examples/configure-http/custom-http-routes.md)             | Intermediate | Mount first-class custom HTTP routes (download, secret-validation POST, auth-gated webhook) on the MCP listener via http.routes. |
| [`entry-path-reverse-proxy`](../examples/configure-http/entry-path-reverse-proxy.md) | Intermediate | Mount the MCP server under a URL prefix for reverse proxy or multi-service setups.                                               |
| [`unix-socket-local`](../examples/configure-http/unix-socket-local.md)               | Intermediate | Bind the server to a unix socket instead of a TCP port for local-only communication.                                             |

> See all examples in [`examples/configure-http/`](../examples/configure-http/)

## Reference

- [HTTP Server Docs](https://docs.agentfront.dev/frontmcp/deployment/local-dev-server)
- Related skills: `configure-throttle`, `configure-transport`, `setup-redis`, `setup-project`
