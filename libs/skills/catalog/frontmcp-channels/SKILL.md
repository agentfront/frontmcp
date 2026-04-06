---
name: frontmcp-channels
description: 'Use when you want to push real-time notifications into Claude Code sessions. Build webhook channels, chat bridges (WhatsApp, Telegram, Slack), agent completion alerts, job status notifications, or error forwarding. The skill for CHANNELS and NOTIFICATIONS.'
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

## Reference

- [Claude Code Channels Reference](https://code.claude.com/docs/en/channels-reference)
- [MCP Specification - Notifications](https://modelcontextprotocol.io/specification/2025-03-26)
- Related skills: `frontmcp-development`, `frontmcp-testing`, `frontmcp-deployment`
