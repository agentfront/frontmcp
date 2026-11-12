---
name: frontmcp-channels
description: 'Use when pushing real-time notifications or events into Claude Code (or another MCP client) sessions, or building two-way chat bridges. Covers channel source types: incoming webhooks (such as GitHub), app error events, agent-completion and job-completion alerts, service connectors, file watchers, and replay buffers; plus two-way conversational bridges connecting WhatsApp, Telegram, Slack, and Discord to a Claude Code session. Triggers: push notifications, real-time alerts, webhook channel, chat bridge, WhatsApp / Telegram / Slack / Discord, agent completion alert, job status notification, error forwarding, server-to-client messaging. The skill for CHANNELS and NOTIFICATIONS.'
when_to_use: |
  Trigger when creating or editing a *.channel.ts file, or building a channel
  that pushes real-time notifications into a Claude Code session: webhook
  sources, app / agent / job event alerts, service connectors, file watchers,
  or a two-way chat bridge (WhatsApp, Telegram, Slack, Discord).
paths: '**/*.channel.ts'
tags:
  [
    channels,
    notifications,
    claude-code,
    webhooks,
    messaging,
    real-time,
    two-way,
    whatsapp,
    telegram,
    slack,
    chat-bridge,
  ]
category: development
targets: [all]
bundle: [full]
priority: 8
visibility: both
license: Apache-2.0
metadata:
  docs: https://code.claude.com/docs/en/channels-reference
---

# FrontMCP Channels

Build push-based notification channels that stream real-time events into Claude Code. Channels let your MCP server forward webhooks, application errors, agent completions, job results, and chat messages directly into Claude's context, with optional two-way reply support.

## When to Use This Skill

### Must Use

- You need Claude Code to react to external events (CI failures, monitoring alerts, deploy status)
- You are building a chat bridge (WhatsApp, Telegram, Slack, Discord) for Claude Code
- You want agents or background jobs to notify Claude Code upon completion

### Recommended

- You want to forward application errors to Claude for debugging assistance
- You need a messaging interface where remote users can interact with Claude via chat platforms

### Skip When

- You only need standard MCP resource subscriptions (use `@Resource` with `resources/subscribe`)
- Your client is not Claude Code and does not support `experimental['claude/channel']`
- You need request-response patterns (use `@Tool` instead)
- You publish something as an event and want a connected Claude Code session to be told: set the `channel` option of the `@Event` (see `create-event`), not a channel

> **Decision:** Use channels when you need server-initiated push notifications into Claude Code. Use resources when the client pulls data on demand.

## Events or Channels

Both reach a Claude Code session as a `<channel>` tag, on the same notification.

| You have                                                         | Use                                        | Why                                                                                                               |
| ---------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Something you publish as an event (`this.events.publish()`)      | `@Event({ channel })` (see `create-event`) | One declaration also serves poll, push and webhook clients, and each session is told only what its caller may see |
| A conversation: Claude answers with the `channel-reply` tool     | `@Channel` with `twoWay: true`             | An event has no reply path                                                                                        |
| A connection to a service (WhatsApp, Telegram, Slack)            | `@Channel` with a `service` source         | The channel owns the connection and its tools                                                                     |
| A raw webhook of another system (GitHub, CI)                     | `@Channel` with a `webhook` source         | It takes any payload on a path; the events publish endpoint takes signed publishes of declared events             |
| Agent or job completions, or an event your code emits on the bus | `@Channel` with that source                | `app-event` stays for events emitted by hand with `scope.channelEventBus.emit()`                                  |

An event with `channel` needs no `@Channel` and no `channels: { enabled: true }`. `channels: { enabled: false }` turns it off.

## Prerequisites

- `@frontmcp/sdk` >= 1.0.0
- Basic understanding of `@FrontMcp`, `@App`, and `@Tool` decorators
- For webhook sources: HTTP transport (not stdio-only)
- For chat bridges: external API credentials (WhatsApp Business API, Telegram Bot Token, etc.)

## Steps

1. Choose your channel source type from the Scenario Routing Table
2. Create a channel class or function
3. Register it in your app
4. Enable channels in `@FrontMcp` config
5. Serve it over stdio and test with Claude Code using `--dangerously-load-development-channels server:<name>`. A
   stdio server has no HTTP listener, so a `webhook` source gets no route there and this step alone does not test
   one (see `references/channel-claude-code.md`)

## Scenario Routing Table

| Scenario                           | Reference                           | Description                                    |
| ---------------------------------- | ----------------------------------- | ---------------------------------------------- |
| Webhook alerts (CI, monitoring)    | `references/channel-sources.md`     | Forward HTTP webhooks into Claude              |
| Application error forwarding       | `references/channel-sources.md`     | Push app errors via event bus                  |
| Agent completion notifications     | `references/channel-sources.md`     | Notify when agents finish                      |
| Job/workflow completion            | `references/channel-sources.md`     | Notify when jobs complete                      |
| Service connector (WhatsApp, etc.) | `references/channel-sources.md`     | Persistent connection with bidirectional tools |
| File/log watcher                   | `references/channel-sources.md`     | Watch declared files and directories           |
| Event replay for offline sessions  | `references/channel-sources.md`     | Buffer events for later delivery               |
| WhatsApp/Telegram chat bridge      | `references/channel-two-way.md`     | Two-way messaging with Claude                  |
| Slack/Discord integration          | `references/channel-two-way.md`     | Chat platform bridges                          |
| Permission relay                   | `references/channel-two-way.md`     | Remote tool approval via chat                  |
| Running a channel in Claude Code   | `references/channel-claude-code.md` | Flags, organization settings, stdio protocol   |

## Using a Channel in Claude Code

Channels are a Claude Code research preview and may change. `references/channel-claude-code.md` has the details.

- **Stdio only.** Claude Code spawns a channel server over stdio. Events arrive only while the session is open.
- **The session opts in.** `claude --channels plugin:<name>@<marketplace>` for an approved plugin, or `claude --dangerously-load-development-channels server:<name>` for your own server. The development flag is interactive only: it is ignored with `-p`.
- **Organizations.** A Team or Enterprise organization needs an Owner to enable channels (`channelsEnabled`, and optionally `allowedChannelPlugins`).
- **No acknowledgement.** Claude Code never acknowledges a notification, and drops it silently when the server is not registered as a channel.
- **`meta` keys.** Letters, digits and underscores only. Claude Code drops any other key, so FrontMCP sends every other character of a key as `_`: `chat-id` arrives as `chat_id`.
- **Protocol.** A stdio server with channels enabled speaks the revisions before 2026-07-28 to every stdio client: it declines `server/discover` and every other 2026-07-28 request with `-32022`, and the client falls back to `initialize`. The stdio session needs no `claude/channel` client capability. An HTTP session still does.

## Common Patterns

| Pattern        | Correct                                    | Incorrect                                       | Why                                                                                                                                     |
| -------------- | ------------------------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Meta keys      | `meta: { env: 'prod' }`                    | `meta: { 'my-env': 'prod' }`                    | Claude Code drops a key with another character. From 1.12 a notification's `my-env` is sent as `my_env`                                 |
| Source naming  | `name: 'deploy-alerts'`                    | `name: 'Deploy Alerts!'`                        | Channel names should be kebab-case identifiers                                                                                          |
| Two-way gating | Check sender identity before emitting      | Trust room/group membership                     | Prevent prompt injection from untrusted group members                                                                                   |
| Error channels | Use `app-event` source with event bus      | Poll for errors in a loop                       | Event bus is push-based and efficient                                                                                                   |
| File watching  | `paths` on a `file-watcher` source         | `fs.watch()` in `onConnect()`                   | From 1.12 the framework watches the declared paths of a channel with no `onConnect()`. One with it still watches by itself              |
| Manual push    | `await scope.channelNotifications?.send()` | `sendToSubscribedSessions()` for a regular push | `send()` runs the hookable `channels:send-notification` flow (defaultMeta, channel meta, hooks); the `sendTo*` methods deliver directly |

## Verification Checklist

### Server Setup

- [ ] `@FrontMcp({ channels: { enabled: true } })` is set
- [ ] Channel classes extend `ChannelContext` with `@Channel()` decorator
- [ ] Channels are listed in `@App({ channels: [...] })`; a channel and the tools in its `tools` resolve its app's providers with `this.get()`, and one whose `availableWhen` the runtime doesn't meet is left out at startup
- [ ] `onEvent()` returns `{ content: string, meta?: Record<string, string> }`; a `meta` key with another character than a letter, a digit or `_` arrives with `_` in its place

### Capability

- [ ] Server advertises `experimental: { 'claude/channel': {} }` in capabilities
- [ ] The stdio session receives notifications with no client declaration; an HTTP session only when its client declares `experimental['claude/channel']`
- [ ] An HTTP session whose latest request came with credentials that have since expired gets no notification, until it makes a request with valid ones
- [ ] Over stdio, `server/discover` and every other 2026-07-28 request get `-32022` with the earlier revisions in `data.supported`, and the client falls back to `initialize`
- [ ] Over HTTP, an MCP 2026-07-28 client (no session) gets them on a `subscriptions/listen` stream whose request's client capabilities include `experimental['claude/channel']`: the global notifications of the channels `channels:list` returns; its `server/discover` advertises `experimental['claude/channel']` and the `<channel>` instructions, as `initialize` does
- [ ] `instructions` field mentions `<channel>` tags when channels are active

### Two-Way

- [ ] `twoWay: true` is set on channels that need replies
- [ ] `channel-reply` tool appears in tool list
- [ ] `onReply()` is implemented and forwards to external system (if it throws, `channel-reply` answers an error result)
- [ ] Sender authentication is enforced before emitting events

### Sources

- [ ] Webhook endpoints return 200 on success
- [ ] Event bus subscriptions are cleaned up on scope teardown, and service channels get `onDisconnect()` on shutdown and on `dispose()`
- [ ] Agent/job completion filters match expected IDs
- [ ] A `file-watcher` channel the framework watches defines no `onConnect()`, declares files or directories, not globs, and reads `{ event, path }` in `onEvent()`

## Troubleshooting

| Problem                                | Cause                                                                                                    | Solution                                                                                                                                                      |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No notifications arrive over HTTP      | The client did not declare the capability                                                                | Check client capabilities include `experimental['claude/channel']`                                                                                            |
| Notifications stop arriving over HTTP  | The credentials of the session's latest request have expired                                             | The session gets them again after its next request with valid credentials                                                                                     |
| No notifications arrive in Claude Code | The session did not register the server as a channel, or the server is not on stdio                      | Serve over stdio and start the session with `--channels` or `--dangerously-load-development-channels server:<name>` (see `references/channel-claude-code.md`) |
| `channel-reply` tool missing           | No two-way channels registered                                                                           | Set `twoWay: true` on at least one channel                                                                                                                    |
| Webhook returns 500                    | `onEvent()` throws                                                                                       | Check channel handler error logs                                                                                                                              |
| A notification never arrives           | A `ChannelSendHook` stopped it, or `ChannelListHook` left the channel out of the session's subscriptions | Check plugins hooking `channels:send-notification` / `channels:list`                                                                                          |
| Duplicate notifications                | Multiple sessions subscribed                                                                             | This is correct behavior -- each session gets its own copy                                                                                                    |
| Events lost on reconnect               | Channels are in-memory                                                                                   | Channel state resets on server restart; use persistent sources                                                                                                |
| A `meta` attribute has `_` in its name | From 1.12, a character of a key that Claude Code would drop the key for is sent as `_`                   | Name the key with letters, digits and underscores, such as `chat_id`                                                                                          |
| A published event arrives twice        | The event has the `channel` option and an `app-event` channel listens to its name                        | Keep one: the `channel` option for a published event. The server warns about it at startup                                                                    |
| A `file-watcher` channel tells nothing | It defines `onConnect()`, a path is a glob, or the runtime is serverless, edge or a browser              | Remove `onConnect()` to have the framework watch; declare the directory, or each file; run a long-lived Node.js process                                       |

## Examples

Each reference has matching examples under [`examples/<reference>/`](./examples/):

### `channel-sources`

| Example                                                                | Level        | Description                                                                                                                      |
| ---------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| [`webhook-github`](./examples/channel-sources/webhook-github.md)       | Basic        | Forward GitHub webhook events (PRs, pushes, CI) into Claude Code                                                                 |
| [`app-errors`](./examples/channel-sources/app-errors.md)               | Basic        | Forward application errors to Claude Code via the in-process event bus                                                           |
| [`agent-notify`](./examples/channel-sources/agent-notify.md)           | Intermediate | Notify Claude Code when AI agents complete their tasks                                                                           |
| [`job-completion`](./examples/channel-sources/job-completion.md)       | Intermediate | Notify Claude Code when background jobs and workflows complete                                                                   |
| [`service-connector`](./examples/channel-sources/service-connector.md) | Advanced     | Build a persistent service connector that lets Claude send and receive messages through WhatsApp, Telegram, or any messaging API |
| [`file-watcher`](./examples/channel-sources/file-watcher.md)           | Intermediate | Watch files for changes and notify Claude Code in real-time                                                                      |
| [`replay-buffer`](./examples/channel-sources/replay-buffer.md)         | Advanced     | Buffer channel events and send them to a session on demand, for events that occurred before it connected                         |

### `channel-two-way`

| Example                                                            | Level    | Description                                                                            |
| ------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------- |
| [`whatsapp-bridge`](./examples/channel-two-way/whatsapp-bridge.md) | Advanced | Full WhatsApp Business API bridge allowing users to chat with Claude Code via WhatsApp |

## Accessing This Skill

Skills are distributed as plain SKILL.md files plus a sibling `references/`
and `examples/` tree, so consumers can pick whichever access mode fits:

| Mode               | How it works                                                                                                                                                                                                                                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Filesystem**     | Read `libs/skills/catalog/frontmcp-channels/` directly from a clone of the catalog repo, or from a published `@frontmcp/skills` install. SKILL.md is the entry point.                                                                                                                                                                               |
| **`frontmcp` CLI** | `frontmcp skills list`, `frontmcp skills read frontmcp-channels`, `frontmcp skills read frontmcp-channels:references/<file>.md`, `frontmcp skills install frontmcp-channels` — no server required.                                                                                                                                                  |
| **MCP `skill://`** | When a developer mounts this skill into their own FrontMCP server (`@FrontMcp({ skills: [...] })`), the SDK exposes it via SEP-2640 resources: `skill://frontmcp-channels/SKILL.md`, `skill://frontmcp-channels/references/{file}.md`, etc. The server’s `skill://index.json` returns the SEP-2640 discovery document for everything mounted on it. |

The catalog itself is **not** an MCP server. The `skill://` URIs only resolve
when a server has been configured to host this skill.

## Reference

- [Claude Code Channels Reference](https://code.claude.com/docs/en/channels-reference)
- [MCP Specification - Notifications](https://modelcontextprotocol.io/specification/2025-03-26)
- Related skills: `frontmcp-development` (`create-event`: the `channel` option of `@Event`), `frontmcp-testing`, `frontmcp-deployment`
