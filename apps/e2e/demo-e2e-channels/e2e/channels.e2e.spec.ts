/**
 * E2E Tests for Channels via Direct Server API
 *
 * Tests the channel system: registration, capabilities, notifications,
 * app-event sources, two-way reply, and manual push.
 */

import { FrontMcpInstance, DirectMcpServer } from '@frontmcp/sdk';
import { serverConfig } from '../src/config';

describe('Channels E2E', () => {
  let server: DirectMcpServer;

  beforeEach(async () => {
    server = await FrontMcpInstance.createDirect(serverConfig);
  });

  afterEach(async () => {
    await server.dispose();
  });

  // ─── Registration & Discovery ─────────────────────────────────

  describe('Channel Registration', () => {
    it('should register all declared channels', async () => {
      const tools = await server.listTools();
      const toolNames = tools.tools.map((t: { name: string }) => t.name);

      // Helper tools should be registered
      expect(toolNames).toContain('emit-app-event');
      expect(toolNames).toContain('send-channel-notification');
      expect(toolNames).toContain('list-reply-log');
    });

    it('should register channel-reply tool for two-way channels', async () => {
      const tools = await server.listTools();
      const toolNames = tools.tools.map((t: { name: string }) => t.name);

      // channel-reply auto-registered because chat-bridge has twoWay: true
      expect(toolNames).toContain('channel-reply');
    });

    it('should advertise experimental channel capability', async () => {
      // The server capabilities are set during initialization.
      // We verify by checking the initialize response (via the server info).
      // The DirectMcpServer wraps initialization, so we verify indirectly
      // by confirming tools that depend on channels being enabled exist.
      const tools = await server.listTools();
      const toolNames = tools.tools.map((t: { name: string }) => t.name);
      expect(toolNames).toContain('channel-reply');
    });
  });

  // ─── App Event Source ─────────────────────────────────────────

  describe('App Event Source', () => {
    it('should emit app event via ChannelEventBus', async () => {
      const result = await server.callTool('emit-app-event', {
        event: 'app:error',
        payload: {
          message: 'Connection timeout',
          level: 'critical',
          code: 'CONN_TIMEOUT',
        },
      });

      expect(result.isError).not.toBe(true);
      const text = (result.content as Array<{ type: string; text?: string }>)?.find((c) => c.type === 'text')?.text;
      expect(text).toBeDefined();
      const data = JSON.parse(text!);
      expect(data.emitted).toBe(true);
      expect(data.event).toBe('app:error');
    });
  });

  // ─── Manual Push ──────────────────────────────────────────────

  describe('Manual Channel Push', () => {
    it('should send notification via ChannelNotificationService', async () => {
      const result = await server.callTool('send-channel-notification', {
        channelName: 'status-updates',
        content: 'Server maintenance starting in 5 minutes',
        meta: { level: 'warning' },
      });

      expect(result.isError).not.toBe(true);
      const text = (result.content as Array<{ type: string; text?: string }>)?.find((c) => c.type === 'text')?.text;
      expect(text).toBeDefined();
      const data = JSON.parse(text!);
      expect(data.sent).toBe(true);
      expect(data.channelName).toBe('status-updates');
    });
  });

  // ─── Two-Way Communication ────────────────────────────────────

  describe('Two-Way Reply', () => {
    it('should reply to a two-way channel', async () => {
      const result = await server.callTool('channel-reply', {
        channel_name: 'chat-bridge',
        text: 'Hello from Claude!',
        meta: { chat_id: 'test-chat-123' },
      });

      expect(result.isError).not.toBe(true);
      const text = (result.content as Array<{ type: string; text?: string }>)?.find((c) => c.type === 'text')?.text;
      expect(text).toContain('successfully');
    });

    it('should record reply in the reply log', async () => {
      // Send a reply first
      await server.callTool('channel-reply', {
        channel_name: 'chat-bridge',
        text: 'Test reply message',
        meta: { chat_id: 'chat-456' },
      });

      // Check the reply log
      const logResult = await server.callTool('list-reply-log', {});
      expect(logResult.isError).not.toBe(true);
      const text = (logResult.content as Array<{ type: string; text?: string }>)?.find((c) => c.type === 'text')?.text;
      expect(text).toBeDefined();
      const data = JSON.parse(text!);
      expect(data.count).toBeGreaterThanOrEqual(1);

      const lastReply = data.replies[data.replies.length - 1];
      expect(lastReply.reply).toBe('Test reply message');
      expect(lastReply.meta.chat_id).toBe('chat-456');
    });

    it('should reject reply to non-existent channel', async () => {
      const result = await server.callTool('channel-reply', {
        channel_name: 'nonexistent-channel',
        text: 'This should fail',
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text?: string }>)?.find((c) => c.type === 'text')?.text;
      expect(text).toContain('not found');
    });

    it('should reject reply to one-way channel', async () => {
      const result = await server.callTool('channel-reply', {
        channel_name: 'deploy-alerts',
        text: 'This should fail - one-way only',
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text?: string }>)?.find((c) => c.type === 'text')?.text;
      expect(text).toContain('does not support replies');
    });
  });

  // ─── Service Connector (WhatsApp-like pattern) ─────────────────

  describe('Service Connector', () => {
    it('should register channel-contributed send-message tool', async () => {
      const tools = await server.listTools();
      const toolNames = tools.tools.map((t: { name: string }) => t.name);

      // send-message tool declared in MessagingServiceChannel.tools
      expect(toolNames).toContain('send-message');
    });

    it('should send outbound message via channel tool', async () => {
      const result = await server.callTool('send-message', {
        to: '+1234567890',
        text: 'Hello from Claude!',
      });

      expect(result.isError).not.toBe(true);
      const text = (result.content as Array<{ type: string; text?: string }>)?.find((c) => c.type === 'text')?.text;
      expect(text).toBeDefined();
      const data = JSON.parse(text!);
      expect(data.sent).toBe(true);
      expect(data.to).toBe('+1234567890');
    });

    it('should track sent messages', async () => {
      // Send a message first
      await server.callTool('send-message', {
        to: '+9876543210',
        text: 'Test outbound message',
      });

      const logResult = await server.callTool('list-sent-messages', {});
      expect(logResult.isError).not.toBe(true);
      const text = (logResult.content as Array<{ type: string; text?: string }>)?.find((c) => c.type === 'text')?.text;
      const data = JSON.parse(text!);
      expect(data.count).toBeGreaterThanOrEqual(1);

      const last = data.messages[data.messages.length - 1];
      expect(last.to).toBe('+9876543210');
      expect(last.text).toBe('Test outbound message');
    });

    it('should simulate incoming message through service connector', async () => {
      const result = await server.callTool('simulate-incoming', {
        from: 'Alice',
        text: 'Can you review my PR?',
        chatId: 'chat-789',
      });

      expect(result.isError).not.toBe(true);
      const text = (result.content as Array<{ type: string; text?: string }>)?.find((c) => c.type === 'text')?.text;
      const data = JSON.parse(text!);
      expect(data.simulated).toBe(true);
    });

    it('should reply through service connector and record in sent messages', async () => {
      const replyResult = await server.callTool('channel-reply', {
        channel_name: 'messaging-service',
        text: 'Sure, I will review it now!',
        meta: { chat_id: 'chat-789' },
      });

      expect(replyResult.isError).not.toBe(true);

      // Verify the reply was recorded as a sent message
      const logResult = await server.callTool('list-sent-messages', {});
      const text = (logResult.content as Array<{ type: string; text?: string }>)?.find((c) => c.type === 'text')?.text;
      const data = JSON.parse(text!);

      const replyMsg = data.messages.find((m: { text: string }) => m.text === 'Sure, I will review it now!');
      expect(replyMsg).toBeDefined();
      expect(replyMsg.to).toBe('chat-789');
    });

    it('should support full bidirectional conversation flow', async () => {
      // Step 1: Claude sends a message via the send-message tool
      const sendResult = await server.callTool('send-message', {
        to: 'Bob',
        text: 'Hi Bob, I need the deploy logs',
      });
      expect(sendResult.isError).not.toBe(true);

      // Step 2: Bob replies (simulated incoming)
      const incomingResult = await server.callTool('simulate-incoming', {
        from: 'Bob',
        text: 'Here are the logs: https://ci.example.com/logs/123',
        chatId: 'bob-chat',
      });
      expect(incomingResult.isError).not.toBe(true);

      // Step 3: Claude replies back via channel-reply
      const replyResult = await server.callTool('channel-reply', {
        channel_name: 'messaging-service',
        text: 'Thanks Bob, I see the issue now.',
        meta: { chat_id: 'bob-chat' },
      });
      expect(replyResult.isError).not.toBe(true);

      // Verify full conversation recorded in sent messages
      const logResult = await server.callTool('list-sent-messages', {});
      const text = (logResult.content as Array<{ type: string; text?: string }>)?.find((c) => c.type === 'text')?.text;
      const data = JSON.parse(text!);
      const msgs = data.messages as Array<{ to: string; text: string }>;

      expect(msgs.some((m) => m.to === 'Bob' && m.text.includes('deploy logs'))).toBe(true);
      expect(msgs.some((m) => m.to === 'bob-chat' && m.text.includes('Thanks Bob'))).toBe(true);
    });
  });

  // ─── Multiple Channels ────────────────────────────────────────

  describe('Multiple Channels', () => {
    it('should handle events across different source types', async () => {
      // Emit app event (app-event source)
      const eventResult = await server.callTool('emit-app-event', {
        event: 'app:error',
        payload: { message: 'Test error', level: 'error' },
      });
      expect(eventResult.isError).not.toBe(true);

      // Send manual notification (manual source)
      const manualResult = await server.callTool('send-channel-notification', {
        channelName: 'status-updates',
        content: 'All systems operational',
      });
      expect(manualResult.isError).not.toBe(true);

      // Reply to chat bridge (webhook source, two-way)
      const replyResult = await server.callTool('channel-reply', {
        channel_name: 'chat-bridge',
        text: 'Acknowledged',
        meta: { chat_id: 'multi-test' },
      });
      expect(replyResult.isError).not.toBe(true);
    });
  });
});
