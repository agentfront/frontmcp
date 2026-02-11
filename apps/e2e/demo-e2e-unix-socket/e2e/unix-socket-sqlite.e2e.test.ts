/**
 * E2E Tests for Unix Socket Transport with SQLite Storage
 *
 * Tests that FrontMcpInstance.runUnixSocket() works with SQLite
 * for session/event storage.
 */

import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FrontMcpInstance } from '@frontmcp/sdk';
import { serverConfig } from '../src/config';
import { notesStore } from '../src/apps/notes/data/notes.store';
import { UnixSocketMcpClient } from './helpers/unix-socket-client';

function uniqueSocketPath(): string {
  return path.join(os.tmpdir(), `mcp-${randomUUID().slice(0, 8)}.sock`);
}

function uniqueSqlitePath(): string {
  return path.join(os.tmpdir(), `mcp-${randomUUID().slice(0, 8)}.sqlite`);
}

async function waitForSocket(socketPath: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(socketPath)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Socket file not created within ${timeoutMs}ms: ${socketPath}`);
}

function cleanupFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // Ignore cleanup errors
  }
  // Also clean up WAL/SHM files for SQLite
  try {
    if (fs.existsSync(filePath + '-wal')) fs.unlinkSync(filePath + '-wal');
  } catch {
    // Ignore
  }
  try {
    if (fs.existsSync(filePath + '-shm')) fs.unlinkSync(filePath + '-shm');
  } catch {
    // Ignore
  }
}

describe('Unix Socket with SQLite E2E', () => {
  let socketPath: string;
  let sqlitePath: string;
  let handle: { close: () => Promise<void> } | null = null;

  beforeEach(() => {
    socketPath = uniqueSocketPath();
    sqlitePath = uniqueSqlitePath();
    notesStore.clear();
  });

  afterEach(async () => {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // Ignore close errors
      }
      handle = null;
    }
    cleanupFile(socketPath);
    cleanupFile(sqlitePath);
  });

  it('should start with SQLite storage and respond to requests', async () => {
    handle = await FrontMcpInstance.runUnixSocket({
      ...serverConfig,
      socketPath,
      sqlite: { path: sqlitePath },
    });
    await waitForSocket(socketPath);

    const client = new UnixSocketMcpClient(socketPath);
    const initResult = await client.initialize();
    expect(initResult.result).toBeDefined();

    // Verify we can list tools
    const toolsResult = await client.request('tools/list', {});
    expect(toolsResult.result).toBeDefined();
    const tools = toolsResult.result as { tools: Array<{ name: string }> };
    expect(tools.tools.map((t) => t.name)).toContain('create-note');
  });

  it('should support tool data operations with SQLite enabled', async () => {
    handle = await FrontMcpInstance.runUnixSocket({
      ...serverConfig,
      socketPath,
      sqlite: { path: sqlitePath },
    });
    await waitForSocket(socketPath);

    const client = new UnixSocketMcpClient(socketPath);
    await client.initialize();

    // Create a note
    const createResult = await client.request('tools/call', {
      name: 'create-note',
      arguments: { title: 'SQLite Note', content: 'With SQLite storage' },
    });
    expect(createResult.error).toBeUndefined();

    const callResult = createResult.result as { content: Array<{ type: string; text: string }> };
    const textContent = callResult.content.find((c) => c.type === 'text');
    if (!textContent) throw new Error('Expected text content in create-note response');
    const created = JSON.parse(textContent.text);
    expect(created.title).toBe('SQLite Note');

    // List notes to verify persistence
    const listResult = await client.request('tools/call', {
      name: 'list-notes',
      arguments: {},
    });
    expect(listResult.error).toBeUndefined();

    const listContent = listResult.result as { content: Array<{ type: string; text: string }> };
    const listText = listContent.content.find((c) => c.type === 'text');
    if (!listText) throw new Error('Expected text content in list-notes response');
    const listed = JSON.parse(listText.text);
    expect(listed.count).toBe(1);
    expect(listed.notes[0].title).toBe('SQLite Note');
  });
});
