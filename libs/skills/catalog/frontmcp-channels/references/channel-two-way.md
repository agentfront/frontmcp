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

## WhatsApp Business API Bridge

```typescript
import { Channel, ChannelContext, ChannelNotification } from '@frontmcp/sdk';

// Store verified senders for security
const allowedSenders = new Set<string>();

@Channel({
  name: 'whatsapp',
  description: 'WhatsApp Business API bridge for Claude Code',
  source: { type: 'webhook', path: '/hooks/whatsapp' },
  twoWay: true,
  meta: { platform: 'whatsapp' },
})
export class WhatsAppChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const { body } = payload as { body: Record<string, unknown> };

    // WhatsApp Cloud API webhook payload structure
    const entry = (body as any).entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];
    const contact = change?.value?.contacts?.[0];

    if (!message || !contact) {
      return { content: 'WhatsApp: received non-message webhook (status update)' };
    }

    const sender = contact.wa_id;
    const senderName = contact.profile?.name ?? sender;

    // Security: only allow verified senders
    if (!allowedSenders.has(sender)) {
      this.logger.warn(`WhatsApp: rejecting message from unverified sender ${sender}`);
      return {
        content: `WhatsApp: message from unverified sender ${senderName} (${sender}). Add to allowlist to process.`,
        meta: { sender, sender_name: senderName, verified: 'false' },
      };
    }

    const text = message.text?.body ?? '[non-text message]';

    return {
      content: `${senderName}: ${text}`,
      meta: {
        sender,
        sender_name: senderName,
        message_id: message.id,
        chat_id: sender,
      },
    };
  }

  async onReply(reply: string, meta?: Record<string, string>): Promise<void> {
    const chatId = meta?.chat_id;
    if (!chatId) {
      this.logger.warn('WhatsApp reply: no chat_id in meta');
      return;
    }

    // Send via WhatsApp Cloud API
    const token = process.env['WHATSAPP_TOKEN'];
    const phoneNumberId = process.env['WHATSAPP_PHONE_ID'];

    await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: chatId,
        text: { body: reply },
      }),
    });
  }
}
```

## Telegram Bot Bridge

```typescript
@Channel({
  name: 'telegram',
  description: 'Telegram bot bridge for Claude Code',
  source: { type: 'webhook', path: '/hooks/telegram' },
  twoWay: true,
  meta: { platform: 'telegram' },
})
export class TelegramChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const { body } = payload as { body: Record<string, unknown> };
    const update = body as {
      message?: {
        chat: { id: number };
        from: { username?: string; first_name: string; id: number };
        text?: string;
      };
    };

    const msg = update.message;
    if (!msg?.text) {
      return { content: 'Telegram: non-text update received' };
    }

    const sender = msg.from.username ?? msg.from.first_name;

    return {
      content: `${sender}: ${msg.text}`,
      meta: {
        chat_id: String(msg.chat.id),
        sender: String(msg.from.id),
        sender_name: sender,
      },
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

### Webhook Verification

Validate webhook signatures for each platform:

```typescript
// WhatsApp: verify X-Hub-Signature-256 header
// Telegram: verify secret_token parameter
// Slack: verify X-Slack-Signature header
```

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
