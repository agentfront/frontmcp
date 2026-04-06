---
name: service-connector
reference: channel-sources
level: advanced
description: Build a persistent service connector that lets Claude send and receive messages through WhatsApp, Telegram, or any messaging API
tags: [service, connector, whatsapp, persistent-connection, bidirectional]
features:
  - Service source type with onConnect/onDisconnect lifecycle
  - Channel-contributed tools for outbound messages
  - pushIncoming() for feeding service events into the notification pipeline
  - Bidirectional conversation flow
---

# Service Connector Channel

Build a persistent service connector that lets Claude send and receive messages through WhatsApp, Telegram, or any messaging API

## Code

```typescript
// src/apps/messaging/tools/send-whatsapp.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'send-whatsapp',
  description: 'Send a WhatsApp message. Replies arrive as channel notifications.',
  inputSchema: {
    to: z.string().describe('Recipient phone number'),
    text: z.string().describe('Message text'),
  },
})
export class SendWhatsAppTool extends ToolContext {
  async execute(input: { to: string; text: string }) {
    const token = process.env['WHATSAPP_TOKEN']!;
    const phoneId = process.env['WHATSAPP_PHONE_ID']!;

    await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: input.to,
        text: { body: input.text },
      }),
    });

    return { sent: true, to: input.to };
  }
}
```

```typescript
// src/apps/messaging/channels/whatsapp.channel.ts
import { Channel, ChannelContext } from '@frontmcp/sdk';
import type { ChannelNotification } from '@frontmcp/sdk';
import { SendWhatsAppTool } from '../tools/send-whatsapp.tool';

const ALLOWED = new Set(process.env['WA_ALLOWED']?.split(',') ?? []);

@Channel({
  name: 'whatsapp',
  description: 'WhatsApp messaging. Send via send-whatsapp tool, replies arrive here.',
  source: { type: 'service', service: 'whatsapp-business' },
  tools: [SendWhatsAppTool], // Auto-registered — Claude calls this to send
  twoWay: true,
  meta: { platform: 'whatsapp' },
})
export class WhatsAppChannel extends ChannelContext {
  private pollingInterval?: ReturnType<typeof setInterval>;

  async onConnect(): Promise<void> {
    // In production: use WhatsApp webhook or long-polling
    // Here we simulate with a polling loop checking an API
    this.logger.info('WhatsApp service: connecting...');

    this.pollingInterval = setInterval(async () => {
      try {
        const messages = await this.fetchNewMessages();
        for (const msg of messages) {
          if (!ALLOWED.has(msg.from)) continue;
          this.pushIncoming(msg); // Feeds into onEvent() → notification pipeline
        }
      } catch (err) {
        this.logger.error('WhatsApp polling error', { error: err });
      }
    }, 5000);
  }

  async onDisconnect(): Promise<void> {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
    this.logger.info('WhatsApp service: disconnected');
  }

  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const msg = payload as { from: string; text: string; chatId: string };
    return {
      content: `${msg.from}: ${msg.text}`,
      meta: { chat_id: msg.chatId, sender: msg.from },
    };
  }

  private async fetchNewMessages(): Promise<Array<{ from: string; text: string; chatId: string }>> {
    // Call WhatsApp Business API or webhook queue
    return [];
  }
}
```

## Conversation Flow

1. Claude calls `send-whatsapp({ to: "+1234567890", text: "Hi Alice!" })`
2. Message delivered to Alice's WhatsApp
3. Alice replies → `onConnect()` polling picks it up → `pushIncoming()`
4. `onEvent()` transforms into `ChannelNotification`
5. Claude sees: `<channel source="whatsapp" sender="Alice">Alice: Got it!</channel>`

## When to Use Service vs Webhook

| Pattern               | Use When                                                         |
| --------------------- | ---------------------------------------------------------------- |
| **Service connector** | You need persistent connections, polling, or WebSocket listeners |
| **Webhook**           | The external service pushes events to your HTTP endpoint         |

## What This Demonstrates

- Service source type with onConnect/onDisconnect lifecycle
- Channel-contributed tools for outbound messages
- pushIncoming() for feeding service events into the notification pipeline
- Bidirectional conversation flow

## Related

- See `channel-sources` for all source type documentation
- See `channel-two-way` for two-way communication patterns
