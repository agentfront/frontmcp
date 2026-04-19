/**
 * Session management tools for testing channel notification isolation.
 *
 * These tools simulate multi-session scenarios by registering fake MCP server
 * sessions with the NotificationService and managing channel subscriptions.
 */

import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

// Use structural types instead of deep internal SDK imports
interface NotificationServiceLike {
  registerServer(sessionId: string, server: unknown): void;
  unregisterServer(sessionId: string): void;
  setClientCapabilities(sessionId: string, capabilities: Record<string, unknown>): void;
  subscribeChannel(sessionId: string, channelName: string): boolean;
  unsubscribeChannel(sessionId: string, channelName: string): boolean;
  subscribeAllChannels(sessionId: string, channelNames: string[]): void;
}
interface ChannelRegistryLike {
  findByName(
    name: string,
  ): { pushNotification(content: string, meta?: Record<string, string>, targetSessionId?: string): void } | undefined;
  getChannelInstances(): Array<{ name: string; twoWay: boolean }>;
}

/** Track which notifications each fake session receives (for test assertions) */
const sessionNotifications = new Map<string, Array<{ content: string; meta: Record<string, string> }>>();

/** Minimal MCP server interface for test notification capture */
interface FakeServer {
  notification(msg: { method: string; params: Record<string, unknown> }): void;
  request(msg: { method: string; params?: unknown }): Promise<unknown>;
}

/** Fake MCP server that captures notifications */
function createFakeServer(sessionId: string): FakeServer {
  return {
    notification(msg: { method: string; params: Record<string, unknown> }) {
      if (msg.method === 'notifications/claude/channel') {
        let list = sessionNotifications.get(sessionId);
        if (!list) {
          list = [];
          sessionNotifications.set(sessionId, list);
        }
        list.push({
          content: msg.params['content'] as string,
          meta: msg.params['meta'] as Record<string, string>,
        });
      }
    },
    async request() {
      return {};
    },
  };
}

// ─── Register Session Tool ──────────────────────────────

@Tool({
  name: 'register-test-session',
  description: 'Register a fake session with channel capability for isolation testing',
  inputSchema: {
    sessionId: z.string().describe('Session ID to register'),
    channels: z.array(z.string()).optional().describe('Channel names to subscribe to (default: all)'),
  },
})
export class RegisterTestSessionTool extends ToolContext<{
  sessionId: z.ZodString;
  channels: z.ZodOptional<z.ZodArray<z.ZodString>>;
}> {
  async execute(input: { sessionId: string; channels?: string[] }) {
    const notifications = this.scope.notifications as NotificationServiceLike;
    const scope = this.scope as unknown as { channels?: ChannelRegistryLike };
    const channelRegistry = scope.channels;

    // Clear any previous notifications for this session
    sessionNotifications.delete(input.sessionId);

    // Register fake server
    const fakeServer = createFakeServer(input.sessionId);
    // Cast required: test fake implements only the notification() method from McpServer
    notifications.registerServer(
      input.sessionId,
      fakeServer as unknown as Parameters<typeof notifications.registerServer>[1],
    );

    // Set client capabilities with claude/channel support
    notifications.setClientCapabilities(input.sessionId, {
      experimental: { 'claude/channel': {} },
    });

    // Subscribe to specified channels (or all if not specified)
    if (channelRegistry) {
      const channelNames = input.channels ?? channelRegistry.getChannelInstances().map((ch) => ch.name);
      notifications.subscribeAllChannels(input.sessionId, channelNames);
      return {
        registered: true,
        sessionId: input.sessionId,
        subscribedChannels: channelNames,
      };
    }

    return { registered: true, sessionId: input.sessionId, subscribedChannels: [] };
  }
}

// ─── Unregister Session Tool ──────────────────────────────

@Tool({
  name: 'unregister-test-session',
  description: 'Unregister a fake session',
  inputSchema: {
    sessionId: z.string().describe('Session ID to unregister'),
  },
})
export class UnregisterTestSessionTool extends ToolContext<{ sessionId: z.ZodString }> {
  async execute(input: { sessionId: string }) {
    const notifications = this.scope.notifications as NotificationServiceLike;
    notifications.unregisterServer(input.sessionId);
    sessionNotifications.delete(input.sessionId);
    return { unregistered: true, sessionId: input.sessionId };
  }
}

// ─── Get Session Notifications Tool ─────────────────────

@Tool({
  name: 'get-session-notifications',
  description: 'Get all channel notifications received by a specific session',
  inputSchema: {
    sessionId: z.string().describe('Session ID to check'),
  },
})
export class GetSessionNotificationsTool extends ToolContext<{ sessionId: z.ZodString }> {
  async execute(input: { sessionId: string }) {
    const notifications = sessionNotifications.get(input.sessionId) ?? [];
    return {
      sessionId: input.sessionId,
      count: notifications.length,
      notifications,
    };
  }
}

// ─── Clear Session Notifications Tool ───────────────────

@Tool({
  name: 'clear-session-notifications',
  description: 'Clear captured notifications for a session',
  inputSchema: {
    sessionId: z.string().describe('Session ID to clear'),
  },
})
export class ClearSessionNotificationsTool extends ToolContext<{ sessionId: z.ZodString }> {
  async execute(input: { sessionId: string }) {
    sessionNotifications.delete(input.sessionId);
    return { cleared: true, sessionId: input.sessionId };
  }
}

// ─── Subscribe/Unsubscribe Channel Tool ─────────────────

const manageSubSchema = {
  sessionId: z.string(),
  channelName: z.string(),
  action: z.enum(['subscribe', 'unsubscribe']),
};

@Tool({
  name: 'manage-channel-subscription',
  description: 'Subscribe or unsubscribe a session from a specific channel',
  inputSchema: manageSubSchema,
})
export class ManageChannelSubscriptionTool extends ToolContext {
  async execute(input: { sessionId: string; channelName: string; action: 'subscribe' | 'unsubscribe' }) {
    const notifications = this.scope.notifications as NotificationServiceLike;

    if (input.action === 'subscribe') {
      const isNew = notifications.subscribeChannel(input.sessionId, input.channelName);
      return { action: 'subscribe', isNew, sessionId: input.sessionId, channelName: input.channelName };
    } else {
      const removed = notifications.unsubscribeChannel(input.sessionId, input.channelName);
      return { action: 'unsubscribe', removed, sessionId: input.sessionId, channelName: input.channelName };
    }
  }
}

// ─── Push Targeted Notification Tool ────────────────────

@Tool({
  name: 'push-targeted-notification',
  description: 'Push a channel notification targeted to a specific session (simulates job/agent completion)',
  inputSchema: {
    channelName: z.string().describe('Channel name'),
    content: z.string().describe('Notification content'),
    targetSessionId: z.string().optional().describe('Target session (undefined = broadcast to all subscribers)'),
  },
})
export class PushTargetedNotificationTool extends ToolContext<{
  channelName: z.ZodString;
  content: z.ZodString;
  targetSessionId: z.ZodOptional<z.ZodString>;
}> {
  async execute(input: { channelName: string; content: string; targetSessionId?: string }) {
    const scope = this.scope as unknown as { channels?: ChannelRegistryLike };
    const channel = scope.channels?.findByName(input.channelName);
    if (!channel) {
      throw new Error(`Channel "${input.channelName}" not found`);
    }

    channel.pushNotification(input.content, {}, input.targetSessionId);
    return {
      pushed: true,
      channelName: input.channelName,
      targeted: !!input.targetSessionId,
      targetSessionId: input.targetSessionId ?? 'all-subscribers',
    };
  }
}
