/**
 * E2E Tests for Channel Replay Buffer
 *
 * Tests event buffering, ring buffer eviction, replay to sessions, and clearing.
 */

import { FrontMcpInstance, DirectMcpServer } from '@frontmcp/sdk';
import { serverConfig } from '../src/config';

function parseToolResult(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const text = result.content?.find((c) => c.type === 'text')?.text;
  return text ? JSON.parse(text) : {};
}

describe('Channels Replay Buffer E2E', () => {
  let server: DirectMcpServer;

  beforeEach(async () => {
    server = await FrontMcpInstance.createDirect(serverConfig);
  });

  afterEach(async () => {
    await server.dispose();
  });

  it('should buffer events when replay is enabled', async () => {
    // Push 3 events through the replay channel
    for (let i = 1; i <= 3; i++) {
      await server.callTool('emit-app-event', {
        event: 'replay:test',
        payload: { index: i, message: `test event ${i}` },
      });
    }

    // Check buffer
    const result = await server.callTool('get-replay-buffer', { channelName: 'replay-alerts' });
    const data = parseToolResult(result as any);
    expect(data.replayEnabled).toBe(true);
    expect(data.bufferSize).toBe(3);
    expect((data.events as any[]).length).toBe(3);
  });

  it('should evict oldest events when buffer exceeds maxEvents', async () => {
    // Push 7 events (maxEvents is 5)
    for (let i = 1; i <= 7; i++) {
      await server.callTool('emit-app-event', {
        event: 'replay:test',
        payload: { index: i, message: `event ${i}` },
      });
    }

    const result = await server.callTool('get-replay-buffer', { channelName: 'replay-alerts' });
    const data = parseToolResult(result as any);
    expect(data.bufferSize).toBe(5); // Capped at maxEvents

    // Oldest events (1, 2) should be evicted, leaving 3-7
    const events = data.events as Array<{ content: string; meta: Record<string, string> }>;
    expect(events[0].meta.index).toBe('3');
    expect(events[4].meta.index).toBe('7');
  });

  it('should clear the replay buffer', async () => {
    // Push events
    for (let i = 1; i <= 3; i++) {
      await server.callTool('emit-app-event', {
        event: 'replay:test',
        payload: { index: i, message: `event ${i}` },
      });
    }

    // Clear buffer
    const clearResult = await server.callTool('clear-replay-buffer', { channelName: 'replay-alerts' });
    const clearData = parseToolResult(clearResult as any);
    expect(clearData.cleared).toBe(true);

    // Verify empty
    const result = await server.callTool('get-replay-buffer', { channelName: 'replay-alerts' });
    const data = parseToolResult(result as any);
    expect(data.bufferSize).toBe(0);
  });

  it('should not buffer events when replay is disabled', async () => {
    // error-alerts channel has no replay config
    await server.callTool('emit-app-event', {
      event: 'app:error',
      payload: { message: 'test error', level: 'error' },
    });

    const result = await server.callTool('get-replay-buffer', { channelName: 'error-alerts' });
    const data = parseToolResult(result as any);
    expect(data.replayEnabled).toBe(false);
    expect(data.bufferSize).toBe(0);
  });

  it('should include source meta in buffered events', async () => {
    await server.callTool('emit-app-event', {
      event: 'replay:test',
      payload: { index: 1, message: 'meta check' },
    });

    const result = await server.callTool('get-replay-buffer', { channelName: 'replay-alerts' });
    const data = parseToolResult(result as any);
    const events = data.events as Array<{ meta: Record<string, string> }>;
    expect(events[0].meta.source).toBe('replay-alerts');
  });
});
