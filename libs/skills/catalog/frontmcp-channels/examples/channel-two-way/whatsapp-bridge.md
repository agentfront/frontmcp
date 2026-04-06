---
name: whatsapp-bridge
reference: channel-two-way
level: advanced
description: Full WhatsApp Business API bridge allowing users to chat with Claude Code via WhatsApp
tags: [whatsapp, chat, two-way, messaging, bridge]
features:
  - Two-way channel with reply support
  - WhatsApp Cloud API integration
  - Sender verification and allowlisting
  - Webhook signature validation
---

# WhatsApp Chat Bridge

Full WhatsApp Business API bridge allowing users to chat with Claude Code via WhatsApp

## Code

```typescript
// src/apps/messaging/channels/whatsapp.channel.ts
import { Channel, ChannelContext, ChannelNotification } from '@frontmcp/sdk';

const ALLOWED_SENDERS = new Set((process.env['WHATSAPP_ALLOWED_SENDERS'] ?? '').split(',').filter(Boolean));

@Channel({
  name: 'whatsapp',
  description: 'WhatsApp chat bridge - verified users can message Claude Code',
  source: { type: 'webhook', path: '/hooks/whatsapp' },
  twoWay: true,
  meta: { platform: 'whatsapp' },
})
export class WhatsAppChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const { body } = payload as { body: Record<string, unknown> };
    const entry = (body as any).entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];
    const contact = change?.value?.contacts?.[0];

    if (!message || !contact) {
      return { content: 'WhatsApp: status update (not a message)' };
    }

    const sender = contact.wa_id as string;
    const senderName = (contact.profile?.name ?? sender) as string;

    if (!ALLOWED_SENDERS.has(sender)) {
      this.logger.warn(`Rejecting message from unverified sender: ${sender}`);
      return {
        content: `WhatsApp: blocked message from unverified sender ${senderName}`,
        meta: { sender, verified: 'false' },
      };
    }

    return {
      content: `${senderName}: ${message.text?.body ?? '[media]'}`,
      meta: {
        chat_id: sender,
        sender,
        sender_name: senderName,
        message_id: message.id,
      },
    };
  }

  async onReply(reply: string, meta?: Record<string, string>): Promise<void> {
    const chatId = meta?.chat_id;
    if (!chatId) {
      this.logger.warn('No chat_id in reply meta');
      return;
    }

    const token = process.env['WHATSAPP_TOKEN']!;
    const phoneId = process.env['WHATSAPP_PHONE_ID']!;

    const response = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
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

    if (!response.ok) {
      this.logger.error(`WhatsApp send failed: ${response.status} ${await response.text()}`);
    }
  }
}
```

```typescript
// src/main.ts
import { FrontMcp, App } from '@frontmcp/sdk';
import { WhatsAppChannel } from './apps/messaging/channels/whatsapp.channel';

@App({
  name: 'Messaging',
  channels: [WhatsAppChannel],
})
class MessagingApp {}

@FrontMcp({
  info: { name: 'whatsapp-bridge', version: '1.0.0' },
  apps: [MessagingApp],
  channels: { enabled: true },
})
export default class Server {}
```

## Setup

1. Create a WhatsApp Business App at [developers.facebook.com](https://developers.facebook.com)
2. Set environment variables: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_ALLOWED_SENDERS`
3. Configure webhook URL to `https://your-server/hooks/whatsapp`
4. Subscribe to `messages` webhook field

## What This Demonstrates

- Two-way channel with reply support
- WhatsApp Cloud API integration
- Sender verification and allowlisting
- Webhook signature validation

## Related

- See `channel-two-way` for the full two-way channel reference
- See `channel-sources` for webhook source details
