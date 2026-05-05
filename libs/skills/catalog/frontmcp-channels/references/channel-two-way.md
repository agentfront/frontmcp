---
name: channel-two-way
description: Build two-way chat bridges connecting WhatsApp, Telegram, Slack, and Discord to Claude Code
---

# Two-Way Channels (Chat Bridges)

Two-way channels let external users communicate with Claude Code through messaging platforms. Claude receives messages as channel events and replies using the auto-registered `channel-reply` tool.

## Architecture

1. **Incoming**: External message arrives (WhatsApp, Telegram, Slack webhook)
2. **Transform**: `onEvent()` converts to `ChannelNotification`
3. **Push**: Notification sent to Claude Code session
4. **Reply**: Claude calls `channel-reply` tool with response text
5. **Forward**: `onReply()` sends the reply back to the external platform

## API Surface

A two-way channel sets `twoWay: true` and implements two hooks on top of the regular `ChannelContext` interface:

```typescript
@Channel({
  name: 'whatsapp',
  source: { type: 'webhook', path: '/hooks/whatsapp' },
  twoWay: true,
  meta: { platform: 'whatsapp' },
})
export class WhatsAppChannel extends ChannelContext {
  // Inbound: shape the external payload into a notification for Claude
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    /* see whatsapp-bridge example */
  }

  // Outbound: forward Claude's reply back to the platform.
  // `meta` carries the keys you returned from onEvent (chat_id, sender, ...).
  async onReply(reply: string, meta?: Record<string, string>): Promise<void> {
    /* call platform send-message API */
  }
}
```

The full WhatsApp implementation, including sender allowlisting and the WhatsApp Cloud API call, lives in [`examples/channel-two-way/whatsapp-bridge.md`](../examples/channel-two-way/whatsapp-bridge.md).

## Telegram Bot Bridge

Telegram works the same way — different webhook path, different reply API:

```typescript
@Channel({
  name: 'telegram',
  source: { type: 'webhook', path: '/hooks/telegram' },
  twoWay: true,
  meta: { platform: 'telegram' },
})
export class TelegramChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const { body } = payload as {
      body: {
        message?: { chat: { id: number }; from: { username?: string; first_name: string; id: number }; text?: string };
      };
    };
    const msg = body.message;
    if (!msg?.text) return { content: 'Telegram: non-text update' };
    const sender = msg.from.username ?? msg.from.first_name;
    return {
      content: `${sender}: ${msg.text}`,
      meta: { chat_id: String(msg.chat.id), sender: String(msg.from.id), sender_name: sender },
    };
  }

  async onReply(reply: string, meta?: Record<string, string>): Promise<void> {
    const chatId = meta?.chat_id;
    if (!chatId) return;
    const token = process.env['TELEGRAM_BOT_TOKEN'];
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: reply }),
    });
  }
}
```

## Security Best Practices

### Sender Gating

Always validate individual sender identity, not room/group membership:

```typescript
// Good: check individual sender
if (!allowedSenders.has(senderId)) {
  return { content: 'Rejected: unverified sender', meta: { verified: 'false' } };
}

// Bad: trust anyone in a group chat
if (isGroupMember(chatId)) {
  /* dangerous */
}
```

### Webhook Signature Verification

Webhook handlers must verify the request actually came from the platform. Use the HMAC helper from `@frontmcp/utils` so the same code runs in Node and Edge runtimes:

```typescript
import { hmacSha256 } from '@frontmcp/utils';

function verifyWhatsAppSignature(rawBody: string, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = header.slice('sha256='.length);

  const key = new TextEncoder().encode(appSecret);
  const data = new TextEncoder().encode(rawBody);
  const digest = hmacSha256(key, data);

  // Constant-time hex compare
  const actual = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// In onEvent:
//
// NOTE: WebhookPayload.body is the parsed JSON. For maximum signature fidelity
// (Meta computes X-Hub-Signature-256 over the exact raw bytes), capture the raw
// body in a transport-level middleware (e.g. express.json `verify` hook) and
// pass that string to `verifyWhatsAppSignature` instead of `JSON.stringify(body)`.
const { body, headers } = payload as { body: unknown; headers: Record<string, string | string[] | undefined> };
const sig = headers['x-hub-signature-256'];
if (
  !verifyWhatsAppSignature(JSON.stringify(body), Array.isArray(sig) ? sig[0] : sig, process.env['WHATSAPP_APP_SECRET']!)
) {
  this.logger.warn('WhatsApp: signature mismatch, dropping');
  return { content: '', meta: { verified: 'false' } };
}
```

Per-platform header names:

| Platform | Header / mechanism                                              |
| -------- | --------------------------------------------------------------- |
| WhatsApp | `X-Hub-Signature-256` (HMAC-SHA256 of raw body with app secret) |
| Telegram | `secret_token` query parameter (compare with the value you set) |
| Slack    | `X-Slack-Signature` + `X-Slack-Request-Timestamp` (HMAC-SHA256) |

### Pairing Codes

For bootstrapping trust, use pairing codes:

```typescript
// 1. User sends "/pair ABC123" in chat
// 2. Server verifies code, adds sender to allowlist
// 3. Future messages from this sender are trusted
```

## Examples

| Example                                                             | Level    | Description                                                                            |
| ------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| [`whatsapp-bridge`](../examples/channel-two-way/whatsapp-bridge.md) | Advanced | Full WhatsApp Business API bridge allowing users to chat with Claude Code via WhatsApp |

> See all examples in [`examples/channel-two-way/`](../examples/channel-two-way/)
