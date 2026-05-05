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
import { hmacSha256 } from '@frontmcp/utils';

const ALLOWED_SENDERS = new Set((process.env['WHATSAPP_ALLOWED_SENDERS'] ?? '').split(',').filter(Boolean));

/**
 * Verify the X-Hub-Signature-256 header WhatsApp Cloud API attaches to every
 * webhook delivery. The header is `sha256=<hex>` where the digest is HMAC-SHA256
 * of the raw request body keyed by the app secret. Uses @frontmcp/utils so the
 * same code runs in Node and Edge runtimes.
 */
function verifyWhatsAppSignature(rawBody: string, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = header.slice('sha256='.length);

  const digest = hmacSha256(new TextEncoder().encode(appSecret), new TextEncoder().encode(rawBody));
  const actual = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');

  // Constant-time compare to avoid timing leaks
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

@Channel({
  name: 'whatsapp',
  description: 'WhatsApp chat bridge - verified users can message Claude Code',
  source: { type: 'webhook', path: '/hooks/whatsapp' },
  twoWay: true,
  meta: { platform: 'whatsapp' },
})
export class WhatsAppChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const { body, headers } = payload as {
      body: Record<string, unknown>;
      headers: Record<string, string | string[] | undefined>;
    };

    // 1. Verify webhook signature before trusting anything in the payload.
    //
    // NOTE: Meta's X-Hub-Signature-256 is computed over the EXACT raw HTTP body bytes.
    // FrontMCP's `WebhookPayload.body` is the parsed JSON, so re-serializing here is
    // approximate — re-stringification can mismatch when Meta's payload contains
    // characters Meta encoded as `\uXXXX` escapes. For production, capture the raw
    // body with a transport-level middleware (e.g. an Express `verify` hook on
    // `express.json()`) and pass that string into `verifyWhatsAppSignature` instead.
    const sigHeader = headers['x-hub-signature-256'];
    const sig = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
    const appSecret = process.env['WHATSAPP_APP_SECRET'];
    if (!appSecret || !verifyWhatsAppSignature(JSON.stringify(body), sig, appSecret)) {
      this.logger.warn('WhatsApp: signature mismatch, dropping payload');
      return { content: '', meta: { verified: 'false', reason: 'bad_signature' } };
    }

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
import { App, FrontMcp } from '@frontmcp/sdk';

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
2. Set environment variables: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ALLOWED_SENDERS`
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
