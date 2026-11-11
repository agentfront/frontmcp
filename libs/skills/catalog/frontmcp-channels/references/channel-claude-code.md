---
name: channel-claude-code
description: Run a FrontMCP channel in a Claude Code session - the stdio server, the flags and organization settings that register it, and what Claude Code does with a notification
---

# Using a Channel in Claude Code

Channels are a Claude Code research preview. The flags, the settings and the notification format may change. See the [Claude Code Channels Reference](https://code.claude.com/docs/en/channels-reference).

## What Claude Code Needs

- **A stdio server.** Claude Code runs a channel as a local MCP server that it spawns over stdio. A channel on an HTTP server does not reach it.
- **An open session.** Events arrive only while the session is open.
- **The channel capability.** The server advertises `experimental['claude/channel']`. FrontMCP does so once `channels: { enabled: true }` is set and an app declares a channel, or once an app declares an event with the `channel` option (see [Events with the `channel` Option](#events-with-the-channel-option)). That is what "channels enabled" means below.
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

`runShared()` and `frontmcp dev --stdio` serve a channel too. Without `--serve`, both pass the stdio connection on to an HTTP server through a bridge (see [Through the stdio Bridge](#through-the-stdio-bridge)).

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

## Through the stdio Bridge

`runShared()` and `frontmcp dev --stdio` without `--serve` keep the stdio connection in a bridge, and send each message to an HTTP server: the shared local server, or the dev server the CLI restarts. A channel reaches Claude Code through both. The bridge does three things for it:

- **It declines revision 2026-07-28 for a server with channels.** At the first 2026-07-28 request, the bridge asks the server with a `server/discover` of its own. When the server advertises `experimental['claude/channel']`, the bridge answers that request, and every later 2026-07-28 request, with `-32022` and the server's earlier revisions in `data.supported`. It drops a 2026-07-28 notification. Claude Code then sends `initialize`.
- **It declares the capability.** The bridge adds `experimental['claude/channel']` to the `initialize` it forwards, and to the one it replays on a restarted or replaced server. The server subscribes the HTTP session as it does the stdio session. The client's other capabilities, and the `initialize` result, are passed on unchanged.
- **It relays the session's notification stream.** After `initialize` the bridge opens the session's stream (`GET` with the session id) and writes each message on it to stdout. It sends the session's next request once the server answered the stream, or after 2 s. The stream follows the session: a restarted dev server, or the next shared server, gets a new one. A stream that drops is opened again, after 250 ms at first and up to 4 s later. The bridge gives it up, until the next session, after five opens in a row failed.

A quiet shared session follows its server. When another server takes the key over, such as a newer version that replaces the session's own, the session moves to it about 8 s after its stream was cut, with no request of its client, and gets that server's events. It reads the key's record (`server.json`) every second once it gave the stream up, and moves when the record names another process, of its own transport and `info.name`.

What stays as it was:

- A server without channels is not declined. Its 2026-07-28 requests are forwarded as before.
- `frontmcp dev --stdio --serve` uses no HTTP server: the dev server speaks stdio itself, as described above.
- A shared session that runs the server in its own process (the fallback of `runShared()`) declines 2026-07-28 too, but gets no channel event: that server offers no notification stream.
- A shared server that was stopped, or whose checkout was removed, is not started again by a quiet session. The session moves at its next request, and gets no channel event until then.

## What Claude Code Does with a Notification

- It shows the event in the session as `← <server>: <content>`, and Claude reads it as a `<channel>` tag.
- It never acknowledges a notification. The server gets no reply and no error.
- It drops a notification silently when the server is not registered as a channel in that session: no flag, a plugin that is not allowed, or an organization with channels off.
- `meta` keys must be letters, digits and underscores. Claude Code drops any other key, such as `my-env`, silently.

## `meta` Keys

FrontMCP makes the keys of every channel notification safe before it sends them, in one place (`channelMetaOf()`):

- A character that is not a letter, a digit or an underscore becomes `_`: `chat-id` is sent as `chat_id`, `user.name` as `user_name`.
- An empty key, and a value that is `undefined` or `null`, are left out. Every other value is sent as a string.
- It applies to what `onEvent()` returns, to `scope.channelNotifications.send()`, to replayed events, and to the `meta` of an event with the `channel` option.

This changed in 1.12. Before, such a key was sent as written, and Claude Code dropped it. A handler that returns `meta: { 'chat-id': id }` now delivers a `chat_id` attribute, so update instructions or prompts that name the attribute. The static `meta` of `@Channel` and `channels.defaultMeta` are still refused at startup when a key is not an identifier.

## Events with the `channel` Option

An `@Event` with `channel` is sent to Claude Code sessions as a channel notification each time it is published, with no `@Channel` (see [`create-event`](../../frontmcp-development/references/create-event.md#telling-a-claude-code-session)):

```typescript
import { Event, EventContext, z } from '@frontmcp/sdk';

@Event({
  name: 'deploy.finished',
  payloadSchema: { version: z.string(), status: z.string() },
  channel: true,
})
class DeployFinished extends EventContext {}
```

- The `content` is the payload as JSON, or what the option's `content` function returns. The `meta` has `event`, the event's name, and `event_id`.
- It needs no `channels: { enabled: true }`. `channels: { enabled: false }` turns it off, with a warning at startup that names the events.
- Everything on this page applies to such a server: stdio only, the session opts in with the flag, and revision 2026-07-28 is declined over stdio.
- A session is told only what its caller may see under the event's rules. Over stdio the caller is anonymous, so a server whose auth signs callers in tells the stdio session nothing.
- A session is checked as the caller of its latest request. Once those credentials have expired it gets nothing, until it makes a request with valid ones.

## Check It

1. Start `claude --dangerously-load-development-channels server:my-server` in a terminal and confirm the warning.
2. Make the server send an event: emit the app event, or call a tool that pushes.
3. The session shows `← my-server: <content>`.

| Symptom                                                                                                                         | Cause                                                          | Fix                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `Channel messages from "my-server" are unavailable: this connection's protocol version has no channel delivery path` at startup | The server answered the `server/discover` probe                | Upgrade to 1.12 or later, and serve the channel over stdio                       |
| Nothing arrives, and the startup notice shows no error                                                                          | The server is not registered as a channel, or it sent nothing  | Check the flag, the server name and `channelsEnabled`; check the server's stderr |
| An attribute has `_` where its `meta` key has another character                                                                 | From 1.12 such a character is sent as `_`, so the key is kept  | Name the key that way, for example `my_env`                                      |
| An event with the `channel` option does not arrive                                                                              | The session's caller may not see it, or channels are disabled  | Check the server's stderr; see `create-event`                                    |
| Nothing arrives with `-p`                                                                                                       | The development flag is ignored outside an interactive session | Run an interactive session                                                       |
