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

## Socket / Transport

- [ ] Unix socket path is configured: `http: { socketPath: '/tmp/my-app.sock' }`
- [ ] Socket file is cleaned up on shutdown (no stale `.sock` files)
- [ ] Stdio transport works as fallback: `frontmcp socket ./src/main.ts`
- [ ] Socket permissions are restrictive (only the owning user can connect)

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
