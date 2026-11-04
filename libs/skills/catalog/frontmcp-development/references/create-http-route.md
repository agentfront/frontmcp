---
name: create-http-route
description: Serve pages, APIs and live SSE views for people beside the MCP endpoint with @HttpRoute classes that share the app's providers, behind people auth and a same-origin check
---

# HTTP Routes: Pages and APIs for People

An `@HttpRoute` class serves an HTTP request beside the MCP endpoint, on the same port. It gets the providers of its app
(`this.get()`), the same instances the app's tools get, so an agent and a person look at one state. Every route runs
through the hookable `http:route` flow, on the Node server and on `createFetchHandler()` alike: the IP filter, the
global rate limit, a same-origin check on mutations, people auth, then `handle()`.

## When to Use This Skill

### Must Use

- A web page, a JSON API or a live view for a person, next to the tools an agent calls
- A page that shows what the agent changed (a board, a queue, a report) while it changes
- Signing a person in to such pages on a local server, without an identity provider

### Recommended

- Replacing a separate dashboard process that rebuilds the state the MCP server already holds
- Replacing a plain `http.routes` handler that needs DI, auth or SSE

### Skip When

- The caller is an MCP client: write a tool or a resource (`create-tool`, `create-resource`)
- A raw handler is enough (a webhook, a file download): `http.routes` in `frontmcp-config` (`configure-http`)
- The server runs only over stdio or `createDirect()`: routes need an HTTP adapter

> **Decision:** Use `@HttpRoute` when a person, through a browser or a script, reads or changes what your tools work on.

## Steps

### Step 1: Write the route

```typescript
import { httpRespond, HttpRoute, HttpRouteContext } from '@frontmcp/sdk';

import { BoardService } from './board.service';

@HttpRoute({ method: 'GET', path: '/board/:id' })
export class BoardPage extends HttpRouteContext {
  async handle() {
    return this.get(BoardService).find(this.params['id']); // an object answers JSON
  }
}

@HttpRoute({ method: 'POST', path: '/board/:id/cards' })
export class AddCardRoute extends HttpRouteContext {
  async handle() {
    const { title } = this.request.body as { title: string };
    await this.get(BoardService).add(this.params['id'], title);
    return undefined; // 204
  }
}

@HttpRoute({ method: 'GET', path: '/', auth: 'public' })
export class HomePage extends HttpRouteContext {
  handle() {
    return httpRespond.html('<h1>Board</h1>');
  }
}
```

`this.request` holds the method, path, headers, query and parsed body; `this.params` the path parameters;
`this.person` the signed-in person on a `'people'` or `'subject'` route. `this.get()`, `this.tryGet()`, `this.scope`,
`this.fetch()` and `this.context` work as in a tool.

What `handle()` returns becomes the response:

| Return value                                         | Response                                      |
| ---------------------------------------------------- | --------------------------------------------- |
| An output from `httpRespond` (`html`, `redirect`, …) | As it is, status and headers included         |
| An output of an `httpRespond` kind that is not valid | `500`, and the error is logged                |
| An object or an array                                | `200` JSON                                    |
| A string                                             | `200` `text/plain`                            |
| Nothing                                              | `204`                                         |
| A thrown `PublicMcpError`                            | Its status, `{ "error": "<its message>" }`    |
| Any other throw                                      | `500 Internal Server Error`, message not sent |

`httpRespond.redirect(location)` answers `302` with that `Location`: an absolute URL, or a path such as `/board` to
stay on this server. A location with whitespace or a control character is not valid. An object whose `kind` is an
`httpRespond` kind (`redirect`, `json`, `text`, `html`, `empty`, …) is always taken as a response, so one that fails
its schema, such as `{ ...httpRespond.json(body), status: 301 }`, fails the request with `500` and logs an
`InvalidHttpRouteResponseError` naming the route and the problem; it is never sent to the client as data. An object
with another `kind`, or none, is sent as JSON.

### Step 2: List it in the app

```typescript
@App({
  name: 'board',
  providers: [BoardService],
  tools: [AddCardTool],
  routes: [BoardEvents, BoardPage, AddCardRoute, HomePage],
})
class BoardApp {}
```

The first route whose method and path match a request answers it, in the order `routes` lists them, so list a
literal path (`/board/events`, Step 4) before a parameter route it would also match (`/board/:id`). A route belongs to
its app's scope: a `standalone` or `splitByApp` app's routes get that app's providers. Paths are
absolute (not under the app's MCP path), and both adapters serve a route wherever its path is.

### Step 3: Turn on people auth

```typescript
@FrontMcp({
  info: { name: 'board', version: '1.0.0' },
  apps: [BoardApp],
  http: { port: 3000, auth: { people: 'loopback-token' } },
})
export default class Server {}
```

With `http.auth.people` set, a route needs a signed-in person unless its `auth` is `'public'`. Without it, routes are
public, and a route that says `auth: 'people'` or `'subject'` fails startup with `InvalidHttpRouteError`.

`auth: 'subject'` is for a page that shows one MCP caller's data, such as the persistent-question inbox: it takes only
a person signed in with a code made by `createCode({ subject })`, and `this.person.subject` names the caller. Each kind
of sign-in opens only its own routes: a subject's session gets `401` on a `'people'` route, and a session from the
startup token gets `401` on a `'subject'` route, so a code sent to one person for their questions opens nothing else.

### Step 4 (optional): Serve a live view over SSE

```typescript
import { HttpRoute, HttpRouteContext, resourceStore } from '@frontmcp/sdk';

export const boardStore = resourceStore();
export const board = boardStore.key<string[]>('board', { initial: [] });

@HttpRoute({ method: 'GET', path: '/board/events', sse: { store: boardStore, topics: [board.name] } })
export class BoardEvents extends HttpRouteContext {
  async handle() {
    return (await board.get()).value; // the view: sent at once, then after each burst of writes
  }
}
```

A write to the key (`board.update(...)` in a tool, or in another process that shares the store) publishes its topic;
the route calls `handle()` again and sends the result as a `data:` event (an object as JSON, a string line by line).
Publishes within `coalesceMs` send one view. A reader that falls behind gets the latest view, not a backlog, so make
each view the whole current state. `undefined` sends nothing. A `: keep-alive` comment goes out after `heartbeatMs`
without a view. The stream ends, and stops listening to the store, when the client disconnects or the server shuts
down, and on a people route when the person's session expires or ends (checked before each view and heartbeat). See
`create-resource` (`materialized-resource`) for the store.

## `@HttpRoute` Options

| Field             | Type                                              | Default                                             | Notes                                                                                                                                                                             |
| ----------------- | ------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `method`          | `'GET' \| 'POST' \| 'PUT' \| 'PATCH' \| 'DELETE'` | Required                                            |                                                                                                                                                                                   |
| `path`            | `string` or `() => string`                        | Required                                            | Literal segments and `:name` parameters (`/board/:id`); Express wildcards and groups (`*`, `()`, `{}`) are refused. A function is called once at startup, for a path from options |
| `auth`            | `'people' \| 'public'`                            | `'people'` with `http.auth.people`, else `'public'` |                                                                                                                                                                                   |
| `sse.store`       | anything with `subscribe(topic, listener)`        | Required with `sse`                                 | A `resourceStore()`; a key's topic is its name                                                                                                                                    |
| `sse.topics`      | `string[]`                                        | Required with `sse`, at least one                   |                                                                                                                                                                                   |
| `sse.coalesceMs`  | `number`                                          | `50`                                                |                                                                                                                                                                                   |
| `sse.heartbeatMs` | `number`                                          | `15000`                                             |                                                                                                                                                                                   |

An SSE route must be `GET`. An invalid option throws `InvalidDecoratorMetadataError` when the class is decorated, for
example `@HttpRoute invalid metadata for "path": path must start with "/" and hold no query, fragment or whitespace`.

### Paths the MCP endpoint keeps

A route on the paths of the MCP endpoint fails startup with `ReservedRouteCollisionError`: `<mcp>/sse`,
`<mcp>/message`, `<mcp>/server-card`, `/oauth/*`, `/.well-known/*`, `/health`, `/metrics` and the health probes, and
any method but `GET` on the MCP path itself. A `GET` route on the MCP path (`/` by default) serves page loads there: a
`GET` that asks for `text/event-stream` or carries `Mcp-Session-Id` still reaches the MCP endpoint, so an SSE route
there, which an `EventSource` could never reach, fails startup with `InvalidHttpRouteError`. Two routes of one scope on
one method and path fail startup with `InvalidHttpRouteError`; when routes of two scopes (`splitByApp`, a standalone
app) serve one path, the first scope's serves it on every adapter.

## People Auth (`'loopback-token'`)

1. **At startup** the server prints, once, to stderr: `[frontmcp] people sign-in token: <token>`. Nothing logs it
   again, and nothing can read it back.
2. **A one-time code.** A CLI or another local process trades the token for a code:
   `POST /_frontmcp/people/code` with `Authorization: Bearer <token>` answers
   `{ "code", "expiresAt", "loginPath": "/_frontmcp/people/login?code=…" }`. A tool in the server needs no token:
   `this.get(LoopbackTokenAuth).createCode()`. `createCode({ subject })` signs the person in for that MCP subject, on
   `auth: 'subject'` routes only: `this.person.subject` there, which is how the persistent-question inbox shows a
   person only their own caller's questions (`printQuestionInboxLink(this)` prints such a link for the calling user on
   the server's console). Any code is a credential: send it to the person, never back to the MCP client, and never to
   a log. Tool code can make one for any subject, so the binding is as strong as the tools that call `createCode`.
3. **The sign-in page.** The person opens `/_frontmcp/people/login?code=<code>&next=/board`. The page signs nothing in:
   its form posts the code back from the server's own origin.
4. **The cookie.** `POST /_frontmcp/people/login` (a form, or JSON `{ "code", "next" }`) spends the code and sets
   `frontmcp_people=<session>; Path=/; Max-Age=<s>; HttpOnly; SameSite=Strict`, plus `Secure` over https, then goes to
   `next` (a path on this server; anything else goes to `/`).

| `http.auth.people` field | Default            | Notes                                                                  |
| ------------------------ | ------------------ | ---------------------------------------------------------------------- |
| `mode`                   | `'loopback-token'` | The string `'loopback-token'` is the same with every default           |
| `codeTtlMs`              | `60000`            | At most `600000`                                                       |
| `sessionTtlMs`           | `43200000` (12 h)  |                                                                        |
| `maxFailedAttempts`      | `5`                | Bad tokens or codes from one client before it is locked out            |
| `lockoutMs`              | `60000`            | How long a lockout lasts, and how long a bad attempt counts            |
| `cookiePath`             | `'/'`              | The cookie's `Path`; set it to the common prefix of your people routes |

An invalid value fails startup with `InvalidPeopleAuthOptionsError` (`http.auth.people: <problem>`).

- A code works once and expires after `codeTtlMs`; the cookie value is a fresh random value, never the token or a code.
- The token, codes and sessions are kept as SHA-256 digests and compared in constant time.
- Sessions live in the server's memory: a restart signs everyone out and prints a new token. All the scopes of one
  server share one token and one set of sessions.
- Cookies are not isolated by port: another server on `localhost` receives `frontmcp_people`, and two FrontMCP servers
  on `localhost` sign each other out unless their `cookiePath`s differ.
- The lockout is keyed by the client's address (`X-Forwarded-For` only behind `FRONTMCP_TRUST_PROXY`), so clients that
  share one address share a lockout.

| Refusal                                     | Status | Code                   |
| ------------------------------------------- | ------ | ---------------------- |
| A people route without a valid session      | `401`  | `PERSON_NOT_SIGNED_IN` |
| A wrong token, or a wrong, used or old code | `401`  | `SIGN_IN_REFUSED`      |
| Too many of them from one client            | `429`  | `SIGN_IN_LOCKED`       |

## The Same-Origin Check

A `POST`, `PUT`, `PATCH` or `DELETE` from another site is refused with `403`
(`{ "error": "Cross-origin requests may not change anything here." }`, `CROSS_ORIGIN_REQUEST`), the sign-in post
included, which makes signing in CSRF-safe. The rules are the loopback Origin rules of the MCP endpoint:

- an `Origin` the server lists in `http.cors.origin` (a string or an array) or
  `http.security.dnsRebindingProtection.allowedOrigins` is accepted, and so is another loopback spelling of the same
  port (`localhost`, `127.0.0.1`, `[::1]`). `cors.origin: true` or `'*'` lists none;
- an `Origin` whose host is the request's `Host` (or `X-Forwarded-Host` when `FRONTMCP_TRUST_PROXY` is set) is accepted
  unless `Sec-Fetch-Site` says something other than `same-origin` or `none`; any other `Origin`, `null` included, is
  refused;
- without an `Origin`, a `Sec-Fetch-Site` other than `same-origin` or `none` is refused;
- a request with neither header (a CLI, an agent) is allowed.

The check compares the `Origin` with the request's own `Host`, which a page on a DNS-rebound name sets to that name.
Host validation (`http.security.dnsRebindingProtection`) is what refuses such a host: it is on by default on a loopback
Node server, and `createFetchHandler()` applies it once `allowedHosts` is set, so set it when a fetch handler listens on
loopback. The session cookie is host-only, so a rebound page never carries it to a people route.

## Hooks

Each stage of `http:route` is hookable: `checkIpFilter`, `findRoute`, `acquireQuota`, `checkSameOrigin`,
`authenticatePerson`, `handle`.

```typescript
import { HttpRouteHook, Plugin } from '@frontmcp/sdk';

@Plugin({ name: 'route-audit' })
export class RouteAuditPlugin {
  @HttpRouteHook.Will('handle')
  async audit(): Promise<void> {
    // runs before every route's handle(), after auth
  }
}
```

## `@HttpRoute` or `http.routes`

|                   | `@HttpRoute`                                 | `http.routes`                          |
| ----------------- | -------------------------------------------- | -------------------------------------- |
| Declared in       | `@App({ routes })`                           | `@FrontMcp({ http: { routes } })`      |
| Handler           | A class with `handle()`, the app's providers | `(req, res, next)`, no DI              |
| Runs through      | The `http:route` flow (hookable)             | The `http:ip-filter` flow              |
| Auth              | People auth                                  | `auth: true`: the MCP `session:verify` |
| Same-origin check | On mutations                                 | None                                   |
| SSE from a store  | `sse: { store, topics }`                     | Write it yourself                      |

## Common Patterns

| Pattern                 | Correct                                              | Incorrect                                       | Why                                                             |
| ----------------------- | ---------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------- |
| State shared with tools | A provider in the app's `providers`, `this.get()`    | A module-level variable                         | Providers are per server, and testable                          |
| A sign-in link          | `this.get(LoopbackTokenAuth).createCode()` in a tool | Put the token in a URL                          | A code works once and expires; the token is for local processes |
| Changing state          | `POST` / `PUT` / `PATCH` / `DELETE`                  | A `GET` that writes                             | Only mutations get the same-origin check                        |
| Live views              | `sse` with whole-state views                         | Deltas in each event                            | A slow reader gets only the latest view                         |
| Open pages              | The page's `auth` set to `'public'`                  | Leave `http.auth.people` off for the whole host | Every other route keeps people auth                             |

## Verification Checklist

- [ ] Each route class extends `HttpRouteContext`, has `handle()`, and is in `@App({ routes })`
- [ ] Routes that change state use `POST`, `PUT`, `PATCH` or `DELETE`
- [ ] With `http.auth.people`, a page without a cookie answers `401`, and the printed token signs a browser in
- [ ] A `POST` with `Origin: https://evil.example` answers `403`
- [ ] An SSE route sends a new view after a write to its store

## Troubleshooting

| Problem                                      | Cause                                        | Solution                                                                 |
| -------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| `401` with a cookie that just worked         | The server restarted: sessions are in memory | Sign in again with a new code                                            |
| `403 Cross-origin requests may not change …` | The page posting is on another origin        | Serve it from the server, or list its origin in `http.cors.origin`       |
| `429` from the sign-in route                 | Too many bad codes from this client          | Wait `lockoutMs`, then use a fresh code                                  |
| `ReservedRouteCollisionError` at startup     | The path is one the MCP endpoint serves      | Move the route                                                           |
| SSE events stop behind a proxy               | The proxy buffers or times out idle streams  | Lower `sse.heartbeatMs`; the route already sends `X-Accel-Buffering: no` |

## Reference

- [HTTP routes](https://frontmcp.dev/reference/sdk/http-route)
- Related skills: `create-resource`, `create-provider`, `create-plugin-hooks`, `official-plugins`, `configure-http`
