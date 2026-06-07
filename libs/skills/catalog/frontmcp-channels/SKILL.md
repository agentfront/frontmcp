---
name: frontmcp-channels
description: 'Use when pushing real-time notifications or events into Claude Code (or another MCP client) sessions, or building two-way chat bridges. Covers channel source types: incoming webhooks (such as GitHub), app error events, agent-completion and job-completion alerts, service connectors, file watchers, and replay buffers; plus two-way conversational bridges connecting WhatsApp, Telegram, Slack, and Discord to a Claude Code session. Triggers: push notifications, real-time alerts, webhook channel, chat bridge, WhatsApp / Telegram / Slack / Discord, agent completion alert, job status notification, error forwarding, server-to-client messaging. The skill for CHANNELS and NOTIFICATIONS.'
when_to_use: |
  Trigger when creating or editing a *.channel.ts file, or building a channel
  that pushes real-time notifications into a Claude Code session: webhook
  sources, app / agent / job event alerts, service connectors, file watchers,
  or a two-way chat bridge (WhatsApp, Telegram, Slack, Discord).
paths: '**/*.channel.ts'
tags: [channels, notifications, claude-code, webhooks, messaging, real-time, two-way]
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

> **Decision:** Use channels when you need server-initiated push notifications into Claude Code. Use resources when the client pulls data on demand.

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
5. Test with Claude Code using `--dangerously-load-development-channels`

## Scenario Routing Table

| Scenario                           | Reference                       | Description                                    |
| ---------------------------------- | ------------------------------- | ---------------------------------------------- |
| Webhook alerts (CI, monitoring)    | `references/channel-sources.md` | Forward HTTP webhooks into Claude              |
| Application error forwarding       | `references/channel-sources.md` | Push app errors via event bus                  |
| Agent completion notifications     | `references/channel-sources.md` | Notify when agents finish                      |
| Job/workflow completion            | `references/channel-sources.md` | Notify when jobs complete                      |
| Service connector (WhatsApp, etc.) | `references/channel-sources.md` | Persistent connection with bidirectional tools |
| File/log watcher                   | `references/channel-sources.md` | File system change monitoring                  |
| Event replay for offline sessions  | `references/channel-sources.md` | Buffer events for later delivery               |
| WhatsApp/Telegram chat bridge      | `references/channel-two-way.md` | Two-way messaging with Claude                  |
| Slack/Discord integration          | `references/channel-two-way.md` | Chat platform bridges                          |
| Permission relay                   | `references/channel-two-way.md` | Remote tool approval via chat                  |

## Common Patterns

| Pattern        | Correct                                 | Incorrect                                    | Why                                                                |
| -------------- | --------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| Meta keys      | `meta: { env: 'prod' }`                 | `meta: { 'my-env': 'prod' }`                 | Meta keys must be valid identifiers (letters, digits, underscores) |
| Source naming  | `name: 'deploy-alerts'`                 | `name: 'Deploy Alerts!'`                     | Channel names should be kebab-case identifiers                     |
| Two-way gating | Check sender identity before emitting   | Trust room/group membership                  | Prevent prompt injection from untrusted group members              |
| Error channels | Use `app-event` source with event bus   | Poll for errors in a loop                    | Event bus is push-based and efficient                              |
| Manual push    | Use `scope.channelNotifications.send()` | Call `pushNotification` on instance directly | Service handles capability filtering                               |

## Verification Checklist

### Server Setup

- [ ] `@FrontMcp({ channels: { enabled: true } })` is set
- [ ] Channel classes extend `ChannelContext` with `@Channel()` decorator
- [ ] Channels are listed in `@App({ channels: [...] })`
- [ ] `onEvent()` returns `{ content: string, meta?: Record<string, string> }`

### Capability

- [ ] Server advertises `experimental: { 'claude/channel': {} }` in capabilities
- [ ] Only sessions with matching capability receive notifications
- [ ] `instructions` field mentions `<channel>` tags when channels are active

### Two-Way

- [ ] `twoWay: true` is set on channels that need replies
- [ ] `channel-reply` tool appears in tool list
- [ ] `onReply()` is implemented and forwards to external system
- [ ] Sender authentication is enforced before emitting events

### Sources

- [ ] Webhook endpoints return 200 on success
- [ ] Event bus subscriptions are cleaned up on scope teardown
- [ ] Agent/job completion filters match expected IDs

## Troubleshooting

| Problem                      | Cause                           | Solution                                                           |
| ---------------------------- | ------------------------------- | ------------------------------------------------------------------ |
| No notifications arrive      | Client doesn't support channels | Check client capabilities include `experimental['claude/channel']` |
| `channel-reply` tool missing | No two-way channels registered  | Set `twoWay: true` on at least one channel                         |
| Webhook returns 500          | `onEvent()` throws              | Check channel handler error logs                                   |
| Duplicate notifications      | Multiple sessions subscribed    | This is correct behavior -- each session gets its own copy         |
| Events lost on reconnect     | Channels are in-memory          | Channel state resets on server restart; use persistent sources     |

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
| [`replay-buffer`](./examples/channel-sources/replay-buffer.md)         | Advanced     | Buffer channel events so Claude Code receives them when it connects, even if events occurred while offline                       |

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
- Related skills: `frontmcp-development`, `frontmcp-testing`, `frontmcp-deployment`
