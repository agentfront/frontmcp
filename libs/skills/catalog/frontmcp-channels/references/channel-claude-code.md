---
name: channel-claude-code
description: Run a FrontMCP channel in a Claude Code session - the stdio server, the flags and organization settings that register it, and what Claude Code does with a notification
---

# Using a Channel in Claude Code

Channels are a Claude Code research preview. The flags, the settings and the notification format may change. See the [Claude Code Channels Reference](https://code.claude.com/docs/en/channels-reference).

## What Claude Code Needs

- **A stdio server.** Claude Code runs a channel as a local MCP server that it spawns over stdio. A channel on an HTTP server does not reach it.
- **An open session.** Events arrive only while the session is open.
- **The channel capability.** The server advertises `experimental['claude/channel']`. FrontMCP does so once `channels: { enabled: true }` is set and an app declares a channel. That is what "channels enabled" means below.
- **An opt-in.** The session names the server as a channel with a flag (see below).

## Serve the Channel over stdio

```typescript
import { FrontMcpInstance } from '@frontmcp/sdk';

import { serverConfig } from './server-config';

FrontMcpInstance.runStdio(serverConfig);
```

A server built with `--target node` serves stdio with its `--stdio` flag. Register either one in the MCP config Claude Code reads, for example `.mcp.json`:

```json
{
  "mcpServers": {
    "my-server": { "command": "/abs/path/dist/node/my-server", "args": ["--stdio"] }
  }
}
```

A stdio server has no HTTP listener, so a `webhook` source gets no route there (see `channel-sources`).

`runShared()` and `frontmcp dev --stdio` without `--serve` pass the stdio connection on to an HTTP server, so the HTTP rule below applies to them: Claude Code gets no channel event through them.

## Opt the Session In

| Server                        | Flag                                                           |
| ----------------------------- | -------------------------------------------------------------- |
| A plugin on the approved list | `claude --channels plugin:<name>@<marketplace>`                |
| Your own server               | `claude --dangerously-load-development-channels server:<name>` |

- `<name>` in `server:<name>` is the server's key under `mcpServers`.
- The development flag works in an interactive session only. With `-p` it is ignored.
- A Team or Enterprise organization needs an Owner to enable channels with the `channelsEnabled` setting. The optional `allowedChannelPlugins` setting lists the plugins the organization allows.

## What FrontMCP Does over stdio

- **No client declaration is needed.** Claude Code's `initialize` declares no `experimental['claude/channel']` capability. The stdio session is subscribed at `initialize` to the channels the `channels:list` flow returns, and gets their notifications.
- **Revision 2026-07-28 is declined.** Claude Code probes a stdio server with `server/discover` on revision 2026-07-28, and delivers no channel event on that revision. A stdio server with channels enabled answers `server/discover`, and every other 2026-07-28 request, with `-32022` and the earlier revisions in `data.supported`. Claude Code then sends `initialize`.
- **Every stdio client is affected.** A stdio server with channels enabled speaks the revisions before 2026-07-28 to every stdio client, whatever `transport.defaultProtocolVersion` says.

Over HTTP nothing changes. An HTTP session gets channel notifications only when its client declares `experimental['claude/channel']`, and HTTP serves revision 2026-07-28 as before.

Before 1.12 a FrontMCP channel reached no Claude Code session: the server answered the 2026-07-28 probe, and sent channel events only to a session that declared the capability.

## What Claude Code Does with a Notification

- It shows the event in the session as `← <server>: <content>`, and Claude reads it as a `<channel>` tag.
- It never acknowledges a notification. The server gets no reply and no error.
- It drops a notification silently when the server is not registered as a channel in that session: no flag, a plugin that is not allowed, or an organization with channels off.
- `meta` keys must be letters, digits and underscores. Claude Code drops any other key, such as `my-env`, silently.

## Check It

1. Start `claude --dangerously-load-development-channels server:my-server` in a terminal and confirm the warning.
2. Make the server send an event: emit the app event, or call a tool that pushes.
3. The session shows `← my-server: <content>`.

| Symptom                                                                                                                         | Cause                                                             | Fix                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `Channel messages from "my-server" are unavailable: this connection's protocol version has no channel delivery path` at startup | The server answered the `server/discover` probe                   | Upgrade to 1.12 or later, and serve the channel over stdio                       |
| Nothing arrives, and the startup notice shows no error                                                                          | The server is not registered as a channel, or it sent nothing     | Check the flag, the server name and `channelsEnabled`; check the server's stderr |
| An attribute is missing from the `<channel>` tag                                                                                | The `meta` key has a character that is not a letter, digit or `_` | Rename the key, for example `my_env`                                             |
| Nothing arrives with `-p`                                                                                                       | The development flag is ignored outside an interactive session    | Run an interactive session                                                       |
