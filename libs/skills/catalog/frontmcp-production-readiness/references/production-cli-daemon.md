---
name: production-cli-daemon
description: Checklist for deploying FrontMCP as a long-running local daemon with socket transport
---

# Production Readiness: CLI Daemon (Local MCP Server)

Checklist for deploying FrontMCP as a long-running local MCP server managed by the FrontMCP process manager (`frontmcp start/stop/restart`).

> Run the `common-checklist` first, then use this checklist for daemon-specific items.

## Process Management

- [ ] Server starts via `frontmcp start <name> --entry ./src/main.ts`
- [ ] `frontmcp stop <name>` cleanly shuts down the daemon
- [ ] `frontmcp restart <name>` works without orphaned processes
- [ ] `frontmcp status` shows the daemon as running
- [ ] `frontmcp logs <name> --follow` streams daemon output
- [ ] A daemon that must not outlive the process that started it sets `lifecycle: { exitWhenOrphaned: true }`: it then shuts down gracefully when its parent exits. Off by default for `runUnixSocket()` and the HTTP server, since a detached daemon outlives its launcher
- [ ] Background task workers (`tasks.runner: 'cli'`) carry the owner mark `TASK_WORKER_MARKER` (`@frontmcp/sdk`): `reapOrphans(TASK_WORKER_MARKER)` (`@frontmcp/utils`) stops the ones whose server is gone, never the calling process or its ancestors (POSIX `ps`, which slim and Alpine images may lack or not support; does nothing on Windows)

## Socket / Transport

- [ ] Unix socket path is configured in a directory only you can write to: ``http: { socketPath: `${os.homedir()}/.frontmcp/sockets/my-app.sock` }`` (a predictable `/tmp` path can be taken by another user while the daemon is down)
- [ ] Socket file is cleaned up on shutdown (no stale `.sock` files)
- [ ] Stdio transport works as fallback: `frontmcp socket ./src/main.ts`
- [ ] Socket permissions are restrictive: FrontMCP creates the socket `0600` (only the owning user can connect) and fails startup if it cannot
- [ ] The socket directory and every directory above it belong to you (or root) and are writable only by their owner (or are sticky, like `/tmp`); startup refuses any other with `UnsafeSocketDirectoryError`
- [ ] A second daemon on the same socket path fails with `SocketInUseError` and the first keeps serving

## Service Registration

- [ ] `frontmcp service install <name>` registers as a system service (launchd/systemd)
- [ ] Service starts automatically on boot (if desired)
- [ ] Service restarts on crash with backoff
- [ ] Logs are captured by the system journal / log file

## Storage

- [ ] SQLite used for local persistence (session, cache)
- [ ] Database file location is configurable (not hardcoded)
- [ ] WAL mode enabled for concurrent reads
- [ ] Automatic migration on startup (if schema changes)
- [ ] Redis optional (only if shared state is needed between instances)

## Graceful Shutdown

On a Unix socket (`runUnixSocket()`, or `bootstrap()` under `FRONTMCP_DAEMON_SOCKET`) `SIGTERM`/`SIGINT` run the same graceful shutdown as the TCP server: stop accepting connections, give requests in flight 5s, shut down and dispose every scope, remove the socket file, exit `0` (`1` if a step fails or it takes over 10s). `handle.close()` runs the same steps without exiting. Up to 1.9.2 a signal removed the socket and exited at once, so a call in flight got an empty reply.

- [ ] SIGTERM handler completes in-flight requests
- [ ] Database connections are closed
- [ ] Socket file is removed
- [ ] PID file is cleaned up

## Health & Monitoring

- [ ] `/health` endpoint responds on the socket
- [ ] Startup errors are logged clearly (not swallowed)
- [ ] `frontmcp doctor` passes all checks
- [ ] Memory usage is stable over time (no leaks)

## Security

- [ ] Socket file has restrictive permissions
- [ ] No network exposure (socket-only, not TCP)
- [ ] Secrets stored in config file with `600` permissions
- [ ] Config stored in `~/.config/<app>/` or XDG directories

## Examples

| Example                                                                                       | Level        | Description                                                                                                                                                    |
| --------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`daemon-socket-config`](../examples/production-cli-daemon/daemon-socket-config.md)           | Basic        | Shows how to configure a FrontMCP server as a long-running local daemon with Unix socket transport, process management, and SQLite storage.                    |
| [`graceful-shutdown-cleanup`](../examples/production-cli-daemon/graceful-shutdown-cleanup.md) | Intermediate | Shows how to layer daemon-specific cleanup (PID file) **on top of** the framework's built-in SIGTERM/SIGINT handler, leaving the socket file to the framework. |
| [`security-and-permissions`](../examples/production-cli-daemon/security-and-permissions.md)   | Advanced     | Shows how to secure a local daemon with restrictive socket permissions, XDG-compliant config storage, and file-based secret management.                        |

> See all examples in [`examples/production-cli-daemon/`](../examples/production-cli-daemon/)
