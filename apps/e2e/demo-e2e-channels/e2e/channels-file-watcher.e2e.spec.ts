/**
 * E2E Tests for File Watcher Channel
 *
 * Tests the file watcher service connector pattern with simulated file events.
 */

import { FrontMcpInstance, DirectMcpServer } from '@frontmcp/sdk';
import { serverConfig } from '../src/config';

function parseToolResult(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const text = result.content?.find((c) => c.type === 'text')?.text;
  return text ? JSON.parse(text) : {};
}

describe('Channels File Watcher E2E', () => {
  let server: DirectMcpServer;

  beforeEach(async () => {
    server = await FrontMcpInstance.createDirect(serverConfig);
  });

  afterEach(async () => {
    await server.dispose();
  });

  it('should register file-watcher channel tools', async () => {
    const tools = await server.listTools();
    const toolNames = tools.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain('simulate-file-event');
  });

  it('should simulate a file change event', async () => {
    const result = await server.callTool('simulate-file-event', {
      file: './logs/app.log',
      event: 'change',
      content: 'ERROR: Connection timeout at line 42',
    });

    expect(result.isError).not.toBe(true);
    const data = parseToolResult(result as any);
    expect(data.simulated).toBe(true);
    expect(data.file).toBe('./logs/app.log');
  });

  it('should simulate a file creation event', async () => {
    const result = await server.callTool('simulate-file-event', {
      file: './logs/new-error.log',
      event: 'create',
    });

    expect(result.isError).not.toBe(true);
    const data = parseToolResult(result as any);
    expect(data.simulated).toBe(true);
    expect(data.event).toBe('create');
  });

  it('should handle multiple file events in sequence', async () => {
    // Simulate several file events
    for (const event of [
      { file: './logs/app.log', event: 'change', content: 'WARN: Slow query' },
      { file: './logs/error.log', event: 'change', content: 'ERROR: OOM killed' },
      { file: './logs/access.log', event: 'create' },
    ]) {
      const result = await server.callTool('simulate-file-event', event);
      expect(result.isError).not.toBe(true);
    }
  });
});
