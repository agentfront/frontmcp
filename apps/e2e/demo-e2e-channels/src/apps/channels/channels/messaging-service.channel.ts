/**
 * Simulated messaging service connector.
 *
 * Demonstrates the service connector pattern:
 * - Claude sends messages via the `send-message` tool
 * - Incoming responses arrive as channel notifications via onEvent()
 * - The channel maintains a persistent "connection" (simulated in-memory)
 *
 * This simulates a WhatsApp/Telegram-like integration where:
 * 1. Claude calls send-message tool → message "sent" to recipient
 * 2. Recipient replies → onEvent() triggered → notification to Claude
 */

import { Channel, ChannelContext, Tool, ToolContext } from '@frontmcp/sdk';
import type { ChannelNotification } from '@frontmcp/sdk';
import { z } from 'zod';

// ─── Simulated Service State ────────────────────────────────────

/** Log of all messages sent through the service (for test verification) */
export const sentMessages: Array<{ to: string; text: string; timestamp: number }> = [];

/** Simulated incoming message queue (test code pushes here, service polls) */
export const incomingQueue: Array<{ from: string; text: string; chatId: string }> = [];

/** Reference to the channel context's pushIncoming for test-driven simulation */
let pushIncomingRef: ((payload: unknown) => void) | undefined;

/** Simulate an incoming message (called from test tools) */
export function simulateIncomingMessage(from: string, text: string, chatId: string): void {
  if (pushIncomingRef) {
    pushIncomingRef({ from, text, chatId });
  } else {
    incomingQueue.push({ from, text, chatId });
  }
}

// ─── Send Message Tool (outbound) ───────────────────────────────

const sendInputSchema = {
  to: z.string().describe('Recipient phone number or chat ID'),
  text: z.string().describe('Message text to send'),
};

@Tool({
  name: 'send-message',
  description:
    'Send a message through the messaging service. The recipient will receive it and may reply, which will appear as a channel notification.',
  inputSchema: sendInputSchema,
  annotations: {
    title: 'Send Message',
    openWorldHint: true,
  },
})
export class SendMessageTool extends ToolContext<typeof sendInputSchema> {
  async execute(input: { to: string; text: string }) {
    sentMessages.push({ to: input.to, text: input.text, timestamp: Date.now() });
    return {
      sent: true,
      to: input.to,
      message: `Message delivered to ${input.to}`,
    };
  }
}

// ─── Messaging Service Channel ──────────────────────────────────

@Channel({
  name: 'messaging-service',
  description:
    'Bidirectional messaging service. Claude sends messages via send-message tool. Incoming replies appear as channel notifications.',
  source: { type: 'service', service: 'simulated-messenger' },
  tools: [SendMessageTool],
  twoWay: true,
  meta: { platform: 'messenger' },
})
export class MessagingServiceChannel extends ChannelContext {
  private pollInterval?: ReturnType<typeof setInterval>;

  async onConnect(): Promise<void> {
    this.logger.info('Messaging service: connecting...');

    // Store pushIncoming reference for direct simulation
    pushIncomingRef = (payload: unknown) => this.pushIncoming(payload);

    // Process any queued messages
    while (incomingQueue.length > 0) {
      const msg = incomingQueue.shift()!;
      this.pushIncoming(msg);
    }

    this.logger.info('Messaging service: connected');
  }

  async onDisconnect(): Promise<void> {
    this.logger.info('Messaging service: disconnecting...');
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }
    pushIncomingRef = undefined;
    this.logger.info('Messaging service: disconnected');
  }

  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const msg = payload as { from: string; text: string; chatId: string };
    return {
      content: `${msg.from}: ${msg.text}`,
      meta: {
        chat_id: msg.chatId,
        sender: msg.from,
      },
    };
  }

  async onReply(reply: string, meta?: Record<string, string>): Promise<void> {
    const chatId = meta?.chat_id ?? 'unknown';
    sentMessages.push({ to: chatId, text: reply, timestamp: Date.now() });
    this.logger.info(`Messaging service: reply sent to ${chatId}: ${reply}`);
  }
}
