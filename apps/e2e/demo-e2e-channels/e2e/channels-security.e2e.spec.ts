/**
 * E2E Tests for Channel Session Isolation & Security
 *
 * Verifies that channel notifications are session-scoped:
 * - Session A's events don't leak to Session B
 * - Unsubscribed sessions never receive notifications
 * - Session-targeted events go ONLY to the originating session
 * - Disconnected sessions stop receiving notifications
 * - Selective channel subscriptions are enforced
 */

import { FrontMcpInstance, DirectMcpServer } from '@frontmcp/sdk';
import { serverConfig } from '../src/config';

function parseResult(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const text = result.content?.find((c) => c.type === 'text')?.text;
  return text ? JSON.parse(text) : {};
}

describe('Channel Security & Session Isolation E2E', () => {
  let server: DirectMcpServer;

  beforeEach(async () => {
    server = await FrontMcpInstance.createDirect(serverConfig);

    // Register two test sessions
    await server.callTool('register-test-session', { sessionId: 'session-A' });
    await server.callTool('register-test-session', { sessionId: 'session-B' });
  });

  afterEach(async () => {
    // Clean up sessions
    await server.callTool('unregister-test-session', { sessionId: 'session-A' });
    await server.callTool('unregister-test-session', { sessionId: 'session-B' });
    await server.dispose();
  });

  // ─── Broadcast Isolation ──────────────────────────────────────

  describe('Broadcast notifications reach all subscribers', () => {
    it('should deliver global event to both subscribed sessions', async () => {
      // Both sessions are subscribed to all channels (default)
      // Push a global event (no target session)
      await server.callTool('push-targeted-notification', {
        channelName: 'deploy-alerts',
        content: 'Deploy v1.0 to production',
      });

      // Both should receive it
      const notifA = parseResult(
        (await server.callTool('get-session-notifications', { sessionId: 'session-A' })) as any,
      );
      const notifB = parseResult(
        (await server.callTool('get-session-notifications', { sessionId: 'session-B' })) as any,
      );

      expect(notifA['count']).toBe(1);
      expect(notifB['count']).toBe(1);
      expect((notifA['notifications'] as any[])[0].content).toBe('Deploy v1.0 to production');
      expect((notifB['notifications'] as any[])[0].content).toBe('Deploy v1.0 to production');
    });
  });

  // ─── Session-Targeted Isolation ───────────────────────────────

  describe('Session-targeted notifications are isolated', () => {
    it('should deliver targeted event ONLY to the specified session', async () => {
      // Simulate a job completion for session-A only
      await server.callTool('push-targeted-notification', {
        channelName: 'deploy-alerts',
        content: 'Job result: session A data (SENSITIVE)',
        targetSessionId: 'session-A',
      });

      const notifA = parseResult(
        (await server.callTool('get-session-notifications', { sessionId: 'session-A' })) as any,
      );
      const notifB = parseResult(
        (await server.callTool('get-session-notifications', { sessionId: 'session-B' })) as any,
      );

      // Session A MUST receive it
      expect(notifA['count']).toBe(1);
      expect((notifA['notifications'] as any[])[0].content).toContain('SENSITIVE');

      // Session B MUST NOT receive it
      expect(notifB['count']).toBe(0);
    });

    it('should isolate targeted events even when both sessions subscribe to same channel', async () => {
      // Both subscribe to deploy-alerts (already done in beforeEach)
      // Send targeted to A, then targeted to B, then global
      await server.callTool('push-targeted-notification', {
        channelName: 'deploy-alerts',
        content: 'SECRET-DATA-A',
        targetSessionId: 'session-A',
      });
      await server.callTool('push-targeted-notification', {
        channelName: 'deploy-alerts',
        content: 'SECRET-DATA-B',
        targetSessionId: 'session-B',
      });
      await server.callTool('push-targeted-notification', {
        channelName: 'deploy-alerts',
        content: 'PUBLIC-DATA',
        // no targetSessionId = global broadcast
      });

      const notifA = parseResult(
        (await server.callTool('get-session-notifications', { sessionId: 'session-A' })) as any,
      );
      const notifB = parseResult(
        (await server.callTool('get-session-notifications', { sessionId: 'session-B' })) as any,
      );

      // A gets its own + global = 2
      expect(notifA['count']).toBe(2);
      const contentsA = (notifA['notifications'] as any[]).map((n: any) => n.content);
      expect(contentsA).toContain('SECRET-DATA-A');
      expect(contentsA).toContain('PUBLIC-DATA');
      expect(contentsA).not.toContain('SECRET-DATA-B');

      // B gets its own + global = 2
      expect(notifB['count']).toBe(2);
      const contentsB = (notifB['notifications'] as any[]).map((n: any) => n.content);
      expect(contentsB).toContain('SECRET-DATA-B');
      expect(contentsB).toContain('PUBLIC-DATA');
      expect(contentsB).not.toContain('SECRET-DATA-A');
    });

    it('should not deliver targeted event to non-existent session', async () => {
      await server.callTool('push-targeted-notification', {
        channelName: 'deploy-alerts',
        content: 'For ghost session',
        targetSessionId: 'session-GHOST',
      });

      // Neither A nor B should receive it
      const notifA = parseResult(
        (await server.callTool('get-session-notifications', { sessionId: 'session-A' })) as any,
      );
      const notifB = parseResult(
        (await server.callTool('get-session-notifications', { sessionId: 'session-B' })) as any,
      );
      expect(notifA['count']).toBe(0);
      expect(notifB['count']).toBe(0);
    });
  });

  // ─── Subscription-Based Isolation ─────────────────────────────

  describe('Channel subscription enforcement', () => {
    it('should not deliver notifications to unsubscribed sessions', async () => {
      // Unsubscribe session-B from deploy-alerts
      await server.callTool('manage-channel-subscription', {
        sessionId: 'session-B',
        channelName: 'deploy-alerts',
        action: 'unsubscribe',
      });

      // Push a global event on deploy-alerts
      await server.callTool('push-targeted-notification', {
        channelName: 'deploy-alerts',
        content: 'Deploy notification',
      });

      const notifA = parseResult(
        (await server.callTool('get-session-notifications', { sessionId: 'session-A' })) as any,
      );
      const notifB = parseResult(
        (await server.callTool('get-session-notifications', { sessionId: 'session-B' })) as any,
      );

      // A is subscribed → receives it
      expect(notifA['count']).toBe(1);
      // B is unsubscribed → does NOT receive it
      expect(notifB['count']).toBe(0);
    });

    it('should enforce per-channel subscription granularity', async () => {
      // Session-B: unsubscribe from deploy-alerts but keep error-alerts
      await server.callTool('manage-channel-subscription', {
        sessionId: 'session-B',
        channelName: 'deploy-alerts',
        action: 'unsubscribe',
      });

      // Push on deploy-alerts
      await server.callTool('push-targeted-notification', {
        channelName: 'deploy-alerts',
        content: 'Deploy event',
      });

      // Push on error-alerts
      await server.callTool('push-targeted-notification', {
        channelName: 'error-alerts',
        content: 'Error event',
      });

      const notifA = parseResult(
        (await server.callTool('get-session-notifications', { sessionId: 'session-A' })) as any,
      );
      const notifB = parseResult(
        (await server.callTool('get-session-notifications', { sessionId: 'session-B' })) as any,
      );

      // A subscribed to both → gets both
      expect(notifA['count']).toBe(2);

      // B unsubscribed from deploy-alerts → only gets error-alerts
      expect(notifB['count']).toBe(1);
      expect((notifB['notifications'] as any[])[0].content).toBe('Error event');
    });

    it('should allow selective subscription at registration time', async () => {
      // Register session-C subscribed only to error-alerts
      await server.callTool('register-test-session', {
        sessionId: 'session-C',
        channels: ['error-alerts'],
      });

      // Push on both channels
      await server.callTool('push-targeted-notification', {
        channelName: 'deploy-alerts',
        content: 'Deploy only',
      });
      await server.callTool('push-targeted-notification', {
        channelName: 'error-alerts',
        content: 'Error only',
      });

      const notifC = parseResult(
        (await server.callTool('get-session-notifications', { sessionId: 'session-C' })) as any,
      );

      // C only subscribed to error-alerts
      expect(notifC['count']).toBe(1);
      expect((notifC['notifications'] as any[])[0].content).toBe('Error only');

      // Cleanup
      await server.callTool('unregister-test-session', { sessionId: 'session-C' });
    });
  });

  // ─── Disconnection Isolation ──────────────────────────────────

  describe('Disconnection cleanup', () => {
    it('should stop delivering notifications after session disconnects', async () => {
      // Unregister session-B (simulates disconnect)
      await server.callTool('unregister-test-session', { sessionId: 'session-B' });

      // Push a global event
      await server.callTool('push-targeted-notification', {
        channelName: 'deploy-alerts',
        content: 'Post-disconnect event',
      });

      const notifA = parseResult(
        (await server.callTool('get-session-notifications', { sessionId: 'session-A' })) as any,
      );
      const notifB = parseResult(
        (await server.callTool('get-session-notifications', { sessionId: 'session-B' })) as any,
      );

      // A still connected → receives it
      expect(notifA['count']).toBe(1);
      // B disconnected → does NOT receive it
      expect(notifB['count']).toBe(0);

      // Re-register for afterEach cleanup
      await server.callTool('register-test-session', { sessionId: 'session-B' });
    });

    it('should clean up channel subscriptions on disconnect', async () => {
      // Unregister and re-register session-B
      await server.callTool('unregister-test-session', { sessionId: 'session-B' });
      // Re-register WITHOUT subscribing to any channels
      await server.callTool('register-test-session', { sessionId: 'session-B', channels: [] });

      // Push event
      await server.callTool('push-targeted-notification', {
        channelName: 'deploy-alerts',
        content: 'After re-register',
      });

      const notifB = parseResult(
        (await server.callTool('get-session-notifications', { sessionId: 'session-B' })) as any,
      );

      // B re-registered but NOT subscribed to deploy-alerts → no notification
      expect(notifB['count']).toBe(0);
    });
  });

  // ─── Multi-Channel Cross-Session Isolation ────────────────────

  describe('Cross-channel session isolation', () => {
    it('should not leak targeted events across channels', async () => {
      // Target session-A on deploy-alerts
      await server.callTool('push-targeted-notification', {
        channelName: 'deploy-alerts',
        content: 'Deploy secret for A',
        targetSessionId: 'session-A',
      });

      // Target session-B on error-alerts
      await server.callTool('push-targeted-notification', {
        channelName: 'error-alerts',
        content: 'Error secret for B',
        targetSessionId: 'session-B',
      });

      const notifA = parseResult(
        (await server.callTool('get-session-notifications', { sessionId: 'session-A' })) as any,
      );
      const notifB = parseResult(
        (await server.callTool('get-session-notifications', { sessionId: 'session-B' })) as any,
      );

      // A gets only deploy secret
      expect(notifA['count']).toBe(1);
      expect((notifA['notifications'] as any[])[0].content).toBe('Deploy secret for A');

      // B gets only error secret
      expect(notifB['count']).toBe(1);
      expect((notifB['notifications'] as any[])[0].content).toBe('Error secret for B');
    });

    it('should handle rapid interleaved events across sessions without leaks', async () => {
      // Fire 10 targeted events alternating between sessions
      const pushes = [];
      for (let i = 0; i < 10; i++) {
        const targetSession = i % 2 === 0 ? 'session-A' : 'session-B';
        pushes.push(
          server.callTool('push-targeted-notification', {
            channelName: 'deploy-alerts',
            content: `Event-${i}-for-${targetSession}`,
            targetSessionId: targetSession,
          }),
        );
      }
      await Promise.all(pushes);

      const notifA = parseResult(
        (await server.callTool('get-session-notifications', { sessionId: 'session-A' })) as any,
      );
      const notifB = parseResult(
        (await server.callTool('get-session-notifications', { sessionId: 'session-B' })) as any,
      );

      // A gets exactly 5 events (indices 0, 2, 4, 6, 8)
      expect(notifA['count']).toBe(5);
      const contentsA = (notifA['notifications'] as any[]).map((n: any) => n.content);
      for (let i = 0; i < 10; i += 2) {
        expect(contentsA).toContain(`Event-${i}-for-session-A`);
      }
      // A must NOT have any of B's events
      for (let i = 1; i < 10; i += 2) {
        expect(contentsA).not.toContain(`Event-${i}-for-session-B`);
      }

      // B gets exactly 5 events (indices 1, 3, 5, 7, 9)
      expect(notifB['count']).toBe(5);
      const contentsB = (notifB['notifications'] as any[]).map((n: any) => n.content);
      for (let i = 1; i < 10; i += 2) {
        expect(contentsB).toContain(`Event-${i}-for-session-B`);
      }
      for (let i = 0; i < 10; i += 2) {
        expect(contentsB).not.toContain(`Event-${i}-for-session-A`);
      }
    });
  });

  // ─── App-Event Broadcast Isolation ────────────────────────────

  describe('App-event broadcast respects subscriptions', () => {
    it('should not deliver app events to sessions unsubscribed from that channel', async () => {
      // Unsubscribe B from error-alerts
      await server.callTool('manage-channel-subscription', {
        sessionId: 'session-B',
        channelName: 'error-alerts',
        action: 'unsubscribe',
      });

      // Emit app event that feeds into error-alerts channel
      await server.callTool('emit-app-event', {
        event: 'app:error',
        payload: { message: 'DB connection lost', level: 'critical' },
      });

      // Wait a tick for async event processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      const notifA = parseResult(
        (await server.callTool('get-session-notifications', { sessionId: 'session-A' })) as any,
      );
      const notifB = parseResult(
        (await server.callTool('get-session-notifications', { sessionId: 'session-B' })) as any,
      );

      // A subscribed → receives it
      expect(notifA['count']).toBe(1);
      // B unsubscribed from error-alerts → does NOT receive it
      expect(notifB['count']).toBe(0);
    });
  });

  // ─── Three-Session Isolation ──────────────────────────────────

  describe('Three-session isolation matrix', () => {
    beforeEach(async () => {
      await server.callTool('register-test-session', {
        sessionId: 'session-C',
        channels: ['deploy-alerts'], // C only subscribes to deploy-alerts
      });
    });

    afterEach(async () => {
      await server.callTool('unregister-test-session', { sessionId: 'session-C' });
    });

    it('should enforce correct isolation across three sessions with different subscriptions', async () => {
      // A: subscribed to all channels
      // B: subscribed to all channels
      // C: subscribed to deploy-alerts only

      // Event 1: Global on deploy-alerts → A, B, C all get it
      await server.callTool('push-targeted-notification', {
        channelName: 'deploy-alerts',
        content: 'Global deploy',
      });

      // Event 2: Global on error-alerts → A, B get it; C does NOT
      await server.callTool('push-targeted-notification', {
        channelName: 'error-alerts',
        content: 'Global error',
      });

      // Event 3: Targeted to session-A on deploy-alerts → only A
      await server.callTool('push-targeted-notification', {
        channelName: 'deploy-alerts',
        content: 'Secret for A only',
        targetSessionId: 'session-A',
      });

      const notifA = parseResult(
        (await server.callTool('get-session-notifications', { sessionId: 'session-A' })) as any,
      );
      const notifB = parseResult(
        (await server.callTool('get-session-notifications', { sessionId: 'session-B' })) as any,
      );
      const notifC = parseResult(
        (await server.callTool('get-session-notifications', { sessionId: 'session-C' })) as any,
      );

      // A: global deploy + global error + targeted = 3
      expect(notifA['count']).toBe(3);

      // B: global deploy + global error = 2 (no targeted leak)
      expect(notifB['count']).toBe(2);
      const contentsB = (notifB['notifications'] as any[]).map((n: any) => n.content);
      expect(contentsB).not.toContain('Secret for A only');

      // C: global deploy only = 1 (no error-alerts, no targeted leak)
      expect(notifC['count']).toBe(1);
      expect((notifC['notifications'] as any[])[0].content).toBe('Global deploy');
    });
  });
});
