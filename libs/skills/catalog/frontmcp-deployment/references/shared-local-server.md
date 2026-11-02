---
name: shared-local-server
description: Serve every stdio session of a server on one machine from one shared local process with FrontMCP's FrontMcpInstance.runShared - one start per key, an owner-only Unix socket or loopback HTTP with a token, a server identity and version proof before the token is sent, a newer session replacing an older server under live sessions, a fallback to running in the session's own process, and exit when idle or when the checkout is removed
---

# Shared Local Server

An MCP client starts a stdio server per session: three Claude Code windows run three copies of your server, each
with its own caches, connections and background work. `FrontMcpInstance.runShared(config, { key })` makes each of
those processes a thin stdio session of **one** server process per key on the machine. The first session finds no
server and starts one; every later session attaches to it.

## When to Use This Skill

### Must Use

- Several stdio sessions of the same server should share one process: one warm cache, one database connection, one
  login, one set of background workers
- A stdio server is expensive to start, and sessions come and go

### Recommended

- Local tools that hold state across sessions (an index of the project, a browser, a device connection)

### Skip When

- One session per process is fine: use `runStdio()` (see `mcp-client-integration`)
- The server is deployed remotely, or several machines share it: run an HTTP server (see `deploy-to-node`)
- Live reload while you develop: use `frontmcp dev --stdio` (see `mcp-client-integration`)

> **Decision:** use `runShared()` when the same server runs as a stdio process in more than one session on one
> machine, and those sessions should see the same server.

## Setup

Keep the config in a module of its own (no decorated `@FrontMcp` class in the entry's import graph, as for
`runStdio()`), and give the shared entry a key:

```typescript
// src/shared.ts
import { FrontMcpInstance } from '@frontmcp/sdk';

import { serverConfig } from './server-config';

FrontMcpInstance.runShared(serverConfig, { key: 'my-server' }).catch((error) => {
  console.error(error);
  process.exit(1);
});
```

Point every MCP client at that entry, exactly like a stdio server:

```json
{
  "mcpServers": {
    "my-server": { "command": "node", "args": ["/abs/path/dist/shared.js"] }
  }
}
```

Starting the server takes the start lock in a SQLite file, so install `@frontmcp/storage-sqlite` next to
`@frontmcp/sdk`. A session that finds its server running doesn't open it.

## Options

| Option           | Type                | Default                        | Meaning                                                                                                           |
| ---------------- | ------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `key`            | `string`            | required                       | Names the server: sessions with the same key and `info.name` on this machine share one process                    |
| `transport`      | `'unix'` / `'http'` | `'unix'` (`'http'` on Windows) | An owner-only Unix socket, or loopback HTTP on `127.0.0.1` with a token                                           |
| `attachBudgetMs` | `number`            | `15000`                        | How long a session tries to reach, start or replace the server before it runs the server in its own process       |
| `replaceOlder`   | `boolean`           | `true`                         | A session that finds a server older than its `info.version` replaces it; `false` runs the server in its process   |
| `idleTimeoutMs`  | `number` / `false`  | `600000`                       | The server exits after this long without a request; `false` keeps it running                                      |
| `checkout`       | `string` / `false`  | the entry file's folder        | The server exits once this folder is removed (a deleted checkout or worktree); `false` never; relative to the cwd |

The default `checkout` is the folder of the file the process runs, as the client started it (`process.argv[1]`): for
a package bin that is the folder of the bin link (`node_modules/.bin`, or the global bin folder), so removing an `npx`
cache takes the server with it, and a global bin folder never goes. Only a folder that is gone counts as removed; one
that can't be checked (no access, a network file system timing out) does not.

Give every session of a key the same `transport`. A session attaches only to a server of its own transport, so one
that finds the key's server running over the other transport starts a second server, which takes the record over;
the first keeps running, with its background work, until you stop it.

`key` is 1 to 64 lowercase letters, digits, `.`, `_` or `-`, starting and ending with a letter or digit, and not a
device name Windows reserves (`con`, `prn`, `aux`, `nul`, `com0`-`com9`, `lpt0`-`lpt9`, with or without an extension):
on a case-insensitive file system (macOS, Windows) `My-Server` and `my-server` would share one folder, and Windows
drops a trailing dot. Use the package name of the server, or another name no other server on the machine uses.
Invalid options reject with `InvalidSharedServerOptionsError` (`INVALID_SHARED_SERVER_OPTIONS`) before anything
starts, for example
`runShared() options are invalid: key: key must be 1 to 64 lowercase letters, digits, ".", "_" or "-", starting and ending with a letter or digit`,
`runShared() options are invalid: key: key can't be a device name Windows reserves (con, prn, aux, nul, com0-9 and lpt0-9)`,
`runShared() options are invalid: transport: transport must be 'unix' or 'http'`,
`runShared() options are invalid: attachBudgetMs: attachBudgetMs must be a whole number of milliseconds from 1 to 600000`,
`runShared() options are invalid: replaceOlder: replaceOlder must be true or false`,
`runShared() options are invalid: idleTimeoutMs: idleTimeoutMs must be a whole number of milliseconds from 1 to 604800000, or false`,
`runShared() options are invalid: checkout: checkout must be the path of a folder, or false`,
`runShared() options are invalid: checkout: <path> is not a folder` (it must exist when the session starts),
`runShared() options are invalid: info.version: a shared server states its version, which must be 1 to 256 printable ASCII characters`
(the config's `info.version` is the version sessions compare), or, on Windows,
`runShared() options are invalid: transport: a Unix socket can't be kept owner-only on Windows; use transport 'http'`.
With the Unix socket, a socket path longer than a socket address holds (103 bytes) is refused the same way:
`runShared() options are invalid: transport: the socket path <path> is longer than 103 bytes; use a shorter key or FRONTMCP_HOME, or transport 'http'`.

## How it works

1. **Attach.** A session reads the server's record, `~/.frontmcp/shared/<key>/server.json` (under `FRONTMCP_HOME`
   when set), and challenges the endpoint it names with a fresh random nonce. The server answers with its version
   (the config's `info.version`) and an HMAC of the nonce, its endpoint (the socket path, or `http://127.0.0.1:<port>`)
   and that version, keyed by a key derived from the secret in the record. Only when the proof verifies (compared in
   constant time) does the session trust the version and send the token, also derived from that secret, as
   `Authorization: Bearer` on every MCP request. Over loopback HTTP it challenges the server again before each request,
   so a process that takes the port of a server that stopped gets none. An answer to a challenge that doesn't state
   its length, or is longer than 1 KiB, is refused unread.
2. **Versions.** A session attaches only to a server of its own `info.name` (the server records it in `server.json`):
   one that finds its key taken by a running server of another name never attaches to it nor replaces it, and runs the
   server in its own process (`its key is taken by a server of another info.name; give each server a key of its own`).
   It never attaches to a server older than its own `info.version`. Versions are compared as semver; equal strings
   are the same version; two versions that aren't both semver can't be ordered, and the session then runs the server
   in its own process rather than replacing one it can't compare. A session of an older version attaches to a newer
   server.
3. **Upgrade.** With `replaceOlder` (the default), a session that finds an older server takes the start lock and asks
   it to drain: `POST /.well-known/frontmcp-shared-server/drain` with the token and its own version, which the server
   accepts (`202`) only from a newer version (`409` otherwise, so an older session never downgrades a newer server).
   The draining server removes its record, answers every new request `503` with `x-frontmcp-shared-server: exiting`,
   lets the requests in flight finish (up to 5 s), and exits; the session waits until it has let go of its endpoint,
   starts its own server and attaches. The sessions of the older server send their next request to the new one: they
   replay the client's `initialize` (its original capabilities), then send the client
   `notifications/tools/list_changed` (and the resources and prompts ones the server advertises). A request no server
   took (refused as `exiting`, the endpoint gone, a `401` from the new server on the socket) is sent again to the next
   server; one that may have reached the old server before it went away is answered `dev_server_unreachable`. A
   server that goes away while a session replays the `initialize` on it is replaced by the next one the same way.
4. **Start.** When no server proves its identity, the session takes the key's start lock (a lease in
   `~/.frontmcp/shared/<key>/start-lock.sqlite`, set only when absent, with a 10 s TTL it renews while it waits), checks
   once more, and runs its own entry again, detached, as the server (the process gets `FRONTMCP_SHARED_SERVE=<key>` and
   `FRONTMCP_SHARED_START_LOCK=<holder>`). The server keeps renewing that lock until it has written its record, so a
   session that dies while its server is slow to start doesn't let another session start a second one. Sessions started
   together wait for that one server; when both a launcher and its server die, the lock lapses and another session takes
   it over. A server that finds the lock taken by another session stops without writing its record
   (`did not start: another session is starting it`), and the session that started it waits for the other one's server.
5. **Fallback.** When a session hasn't attached within `attachBudgetMs` (the server is wedged or unreachable), when the
   server it started exits, when it may not replace an older one, or when its key is taken by a server of another
   `info.name`, it runs the server in its own process: the same config with the same flows and hooks, static-token
   auth for a fresh token, served in-process with no listener. Its duties take the same leases as the shared server's,
   so one that still runs doesn't run them twice. It says so once on stderr:
   `[frontmcp shared] warn running the shared server "<key>" in this process: <reason>`, and stays that way for the rest
   of the session.
6. **Serve.** The server generates a fresh secret, listens, and only then writes the record. It serves the config
   through the normal HTTP flows (`http:request`, `session:verify`, the MCP handlers, every hook), with `auth`
   replaced by static-token auth for that token and `http` replaced by the shared endpoint, so a configured `auth`,
   `http.routes` or CORS does not apply to it. An app with `auth` of its own (an `@App({ auth })` that gets an
   endpoint of its own, with `splitByApp` or `standalone`) would keep that auth and answer without the token, so the
   server refuses to start (and so does a session running it in its own process):
   `The shared server "<key>" did not start: app "<id>" has auth of its own (mode <mode>), which the shared server's token would not guard; remove auth from its @App, or serve it without runShared()`.
   The identity challenge and the drain are flows of their own, `shared:identify`
   (`POST /.well-known/frontmcp-shared-server`) and `shared:drain`, hookable like any other.
7. **Exit.** The server exits once it had no request carrying the token (or identity challenge) for `idleTimeoutMs`,
   once its `checkout` folder is removed, when a newer session drains it, or on `SIGTERM` / `SIGINT`. Each way, it
   refuses new requests as `exiting`, removes its record and its socket, lets the requests in flight finish, and logs
   `The shared server "<key>" exits: <reason>` to its log file. A session that is just attaching sends its request to
   the next server (starting one when none runs, once an exiting server let go of the socket), so it never fails for
   it. The start lock file stays: it is the key's coordination point, and no lease is left held in it.
8. **Bridge.** The session is the same stdio bridge `frontmcp dev --stdio` uses: newline-delimited JSON-RPC on
   stdin/stdout, frames buffered while the session attaches, the server's `mcp-session-id` reused on every request.
   When stdin ends or the client goes away, the session ends its MCP session on the server and exits; the server keeps
   running for the other sessions.

## Files and security

| Path (under `~/.frontmcp/shared/<key>/`) | Mode   | Holds                                                       |
| ---------------------------------------- | ------ | ----------------------------------------------------------- |
| the folder                               | `0700` | created owner-only                                          |
| `server.json`                            | `0600` | `info.name`, transport, port, MCP path, pid, and the secret |
| `server.sock`                            | `0600` | the Unix socket (transport `'unix'`)                        |
| `start-lock.sqlite`                      | `0600` | the start lock                                              |

- A folder that the group or others can write to, or that belongs to another user, or one above it that does (unless
  sticky, like `/tmp`), is refused with `UnsafeSharedServerDirectoryError` (`UNSAFE_SHARED_SERVER_DIRECTORY`):
  `Refusing to keep the shared server's files under <path> (mode <mode>): <reason>. Set FRONTMCP_HOME to a folder only you can write to.`
  A `server.json` that is a link, belongs to another user, or that the group or others can read is refused the same
  way.
- **Other users** can't reach the Unix socket at all. On loopback HTTP they can connect, but every MCP request needs
  the token; a process that takes the port of a server that stopped, before a session attaches or while sessions are
  attached, gets challenges it can't answer, and is not sent a request or the token, except in the instant described
  below. A proof replayed from an earlier challenge, made with an earlier server's key, bound to another endpoint, or
  claiming another version is refused, so a squatter can't pass for a newer server either. Only a holder of the token
  can make a server drain, and only for a newer version.
- **Web pages** can't reach the socket. On loopback HTTP the server accepts only the loopback names as `Host` (DNS
  rebinding) and refuses every request that carries an `Origin`.
- The record is what a session trusts: a server proves it holds the record's secret, not that it is yours. That is
  why the folder checks above matter, and why `FRONTMCP_HOME` must be a folder only you can write to.
- Endpoints that need no token on any FrontMCP server still answer other users on loopback HTTP: the health routes
  (`/health`, `/healthz`, `/readyz`: the server's name, version and counts) and routes a plugin adds.
- A process that takes the port in the instant between a challenge and the request it guards could receive that one
  request, its payload included; the token it carries is useless, since it dies with the server.
- **Same-user processes** can read the record, as they can read everything else of yours: the shared server trusts
  them like any stdio server does. One that holds the token can make a server drain by claiming a newer version, as it
  could stop its pid.
- **Two servers on one key** are told apart by `info.name`, so a project that picks a key another one uses never takes
  over that project's server nor its sessions. Two checkouts of one project (the same `info.name`) do share a server.
- **A stale socket** a crashed server left is removed by the next server that starts; a live one that doesn't prove
  its identity is never replaced.
- The secret and the token are never logged, put in an argument or passed in the environment.
- On Windows the files are kept private by your profile folder's permissions; modes aren't checked there, so keep
  `FRONTMCP_HOME` (if you set it) inside your profile.

## Errors

| Error                              | Code                             | When                                                                                   |
| ---------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------- |
| `InvalidSharedServerOptionsError`  | `INVALID_SHARED_SERVER_OPTIONS`  | an option, or `info.version`, is invalid                                               |
| `UnsafeSharedServerDirectoryError` | `UNSAFE_SHARED_SERVER_DIRECTORY` | another user could replace or read the server's files                                  |
| `SharedServerStartError`           | `SHARED_SERVER_START_FAILED`     | `The shared server "<key>" did not start: <reason>` (it exited, or none proved itself) |
| `SharedServerIdentityError`        | `SHARED_SERVER_IDENTITY_REFUSED` | `The process at <endpoint> did not prove it is the shared server` (loopback HTTP)      |

A session that can't attach runs the server in its own process instead (see Fallback); only when that fails too does
it answer the requests it holds with `dev_reload_deadline` (`-32097`), carrying the reason in `error.data.error`, write
`[frontmcp shared] error attach-failed …` to stderr, and `runShared()` rejects. A request that may have reached a
server that then went away is answered with `dev_server_unreachable` (`-32099`); the session's next requests go to the
next server.

## Limits

- Idle means no request: a session that stays quiet past `idleTimeoutMs` finds the server gone, and its next request
  starts a new one (with the `initialize` replayed). Server-side state of that session (subscriptions, session memory)
  isn't carried over, nor is work the server runs in the background after a call returned.
- The version compared is `info.version`: a code change that doesn't bump it is not an upgrade. A session that runs the
  server in its own process stays that way until its client restarts it.
- The server runs with the environment, working folder and Node flags of the session that started it (an inspector
  flag such as `--inspect` too, so the process that runs your tools can be debugged). A later session's own
  environment isn't applied: two client configs that pass different credentials in `env` need different keys.
- Sessions speak to the server over streamable HTTP like `frontmcp dev --stdio` without `--serve`, so a client on MCP
  `2026-07-28` isn't served yet.
- A key names one server per user on the machine: give each server its own key. Sessions of one key and `info.name`
  share a server whatever folder they run from, two checkouts or worktrees of one project included (the newer version
  replacing the older): give each checkout a key of its own to keep them apart.

## Troubleshooting

| Problem                                                  | Fix                                                                                                                                    |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `did not start: it exited with code 1`                   | Run the entry with `FRONTMCP_SHARED_SERVE=<key>` in a terminal to see why the server can't start; its log is under `~/.frontmcp/logs/` |
| `running the shared server "<key>" in this process: …`   | The reason follows: a wedged server (stop the pid in `server.json`), an older server with `replaceOlder: false`, or a start failure    |
| `which can't be ordered against this session's …`        | Use semver `info.version`s, or the same version, in every checkout that shares the key                                                 |
| `app "<id>" has auth of its own`                         | Remove `auth` from that `@App`: on a shared server the token guards every app                                                          |
| `its key is taken by a server of another info.name`      | Another server runs under the same key: give each server a key of its own, such as its package name                                    |
| `checkout: <path> is not a folder`                       | Point `checkout` at a folder that exists, or set it to `false`                                                                         |
| `did not start: another session is starting it`          | Seen when running the server by hand while another session starts one; a session whose server stops this way waits for the other's     |
| `the sqlite type needs @frontmcp/storage-sqlite`         | Install `@frontmcp/storage-sqlite`: the start lock lives in SQLite                                                                     |
| `Unix socket … is already in use by a running server`    | A process that is not the server listens on the socket: stop it (the pid of the real server is in `server.json`)                       |
| `the process at … did not prove it is the shared server` | Something else answers on the recorded endpoint; the session sent it nothing and starts a server of its own. Check what listens there  |
| `Refusing to keep the shared server's files under …`     | Make the folder (and those above it) writable by you only, or set `FRONTMCP_HOME` to such a folder                                     |

## Reference

- [MCP clients](https://frontmcp.dev/reference/deployment/mcp-clients)
- Related: `mcp-client-integration`, `deploy-to-node`
