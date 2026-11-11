# Claude Code channel check

A manual check that a real Claude Code session receives a channel event from this demo server. It is not run in CI: it needs an interactive terminal and a Claude login.

`e2e/channels-claude-code-stdio.e2e.spec.ts` replays the same messages without Claude Code, and runs in CI.

## What it checks

- Claude Code probes the server with `server/discover` on protocol revision 2026-07-28. The server declines with `-32022`, and Claude Code falls back to `initialize`.
- Claude Code registers the server as a channel, although its `initialize` declares no `experimental['claude/channel']` capability.
- An event the server sends on its `error-alerts` channel shows up in the session.

## Requirements

- `claude` and `expect` on the `PATH`, and `yarn install` done in this repository.
- A Claude login where channels are allowed. A Team or Enterprise organization needs an Owner to set `channelsEnabled`.
- An interactive terminal. `--dangerously-load-development-channels` is ignored with `-p`.

## Run it

From `apps/e2e/demo-e2e-channels`:

```bash
OUT=$(mktemp -d)
cat > "$OUT/mcp.json" <<EOF
{
  "mcpServers": {
    "frontmcp-channels": {
      "command": "node",
      "args": ["$PWD/scripts/claude-code/capture-wrapper.mjs", "$OUT/capture.log"],
      "env": { "CAPTURE_EMIT_EVENT": "1" }
    }
  }
}
EOF
expect scripts/claude-code/channel-check.exp "$OUT/mcp.json" "$OUT/screen.log"
```

`channel-check.exp` starts Claude Code with this command, confirms the development channel warning, waits 30 seconds and quits:

```bash
claude --dangerously-load-development-channels server:frontmcp-channels --mcp-config "$OUT/mcp.json" --strict-mcp-config
```

`capture-wrapper.mjs` runs `src/stdio-entrypoint.ts` and writes every line that passes between Claude Code and the server to `capture.log`. With `CAPTURE_EMIT_EVENT=1`, it calls the server's `emit-app-event` tool six seconds after `notifications/initialized`, so the server sends one channel event. Without it, the wrapper only logs.

To check an event with the `channel` option, ask Claude in the session to call `publish-deploy-event`: the occurrence arrives the same way, with `event` and `event_id` in `meta`.

## What a pass looks like

On screen, and in `screen.log`, the event arrives as a line that starts with the server name:

```text
← frontmcp-channels: [INFO] FrontMCP channel check. No action needed; reply with ok only.
```

In `capture.log`, in this order:

```bash
grep -E '"code":-32022|"method":"initialize"|notifications/claude/channel' "$OUT/capture.log"
```

- `SERVER->CLIENT` the `-32022` error that answers `server/discover`, with the revisions before 2026-07-28 in `data.supported`;
- `CLIENT->SERVER` an `initialize` request;
- `SERVER->CLIENT` a `notifications/claude/channel` line whose `meta.source` is `error-alerts`.

## What a failure looks like

- The screen says `Channel messages from "frontmcp-channels" are unavailable: this connection's protocol version has no channel delivery path`: the server answered the `server/discover` probe instead of declining it.
- `capture.log` has the `WRAPPER->SERVER` call and no `notifications/claude/channel` line: the server did not send the event to the stdio session.
- `capture.log` has the `notifications/claude/channel` line and the screen shows nothing: Claude Code did not register the channel. It drops such a notification silently. Check the flag, the server name and the organization setting.

`capture.log` holds what your Claude Code sent, so keep it out of the repository.
