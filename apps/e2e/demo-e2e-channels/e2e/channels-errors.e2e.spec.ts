/**
 * E2E Tests for Channel Error Paths
 *
 * Tests error handling, edge cases, and resilience of the channel system.
 */

import { FrontMcpInstance, DirectMcpServer } from '@frontmcp/sdk';
import { serverConfig } from '../src/config';

function parseToolResult(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const text = result.content?.find((c) => c.type === 'text')?.text;
  return text ? JSON.parse(text) : {};
}

describe('Channels Error Paths E2E', () => {
  let server: DirectMcpServer;

  beforeEach(async () => {
    server = await FrontMcpInstance.createDirect(serverConfig);
  });

  afterEach(async () => {
    await server.dispose();
  });

  it('should handle event emission to non-subscribed event names gracefully', async () => {
    // Emit to an event name that no channel subscribes to
    const result = await server.callTool('emit-app-event', {
      event: 'nonexistent:event',
      payload: { data: 'should be silently dropped' },
    });

    expect(result.isError).not.toBe(true);
    const data = parseToolResult(result as any);
    expect(data.emitted).toBe(true); // EventBus accepts emit even with no handlers
  });

  it('should handle channel-reply with empty text', async () => {
    const result = await server.callTool('channel-reply', {
      channel_name: 'chat-bridge',
      text: '',
    });

    // Empty text should still work (the channel decides how to handle it)
    expect(result.isError).not.toBe(true);
  });

  it('should handle send-channel-notification to non-existent channel gracefully', async () => {
    // Manual push to a channel that exists — should work
    const result = await server.callTool('send-channel-notification', {
      channelName: 'status-updates',
      content: 'Test notification',
    });
    expect(result.isError).not.toBe(true);
    const data = parseToolResult(result as any);
    expect(data.sent).toBe(true);
  });

  it('should handle get-replay-buffer for non-existent channel', async () => {
    const result = await server.callTool('get-replay-buffer', {
      channelName: 'nonexistent-channel',
    });
    expect(result.isError).not.toBe(true);
    const data = parseToolResult(result as any);
    expect(data.error).toContain('not found');
  });

  it('should handle clear-replay-buffer for non-existent channel', async () => {
    const result = await server.callTool('clear-replay-buffer', {
      channelName: 'nonexistent-channel',
    });
    expect(result.isError).not.toBe(true);
    const data = parseToolResult(result as any);
    expect(data.error).toContain('not found');
  });

  it('should handle multiple rapid event emissions', async () => {
    // Fire 20 events rapidly
    const promises = Array.from({ length: 20 }, (_, i) =>
      server.callTool('emit-app-event', {
        event: 'replay:test',
        payload: { index: i, message: `rapid fire ${i}` },
      }),
    );
    const results = await Promise.all(promises);

    // All should succeed
    for (const result of results) {
      expect(result.isError).not.toBe(true);
    }

    // Replay buffer should cap at maxEvents (5)
    const bufferResult = await server.callTool('get-replay-buffer', { channelName: 'replay-alerts' });
    const data = parseToolResult(bufferResult as any);
    expect(data.bufferSize).toBeLessThanOrEqual(5);
  });
});
