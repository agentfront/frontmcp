import { test, expect } from '@frontmcp/testing';
import { notesStore, Note } from '../src/apps/notes/data/store';

/** Response types for notes app */
type NoteResponse = Note;
interface NotesListResponse {
  notes: Note[];
  count: number;
}
interface DeleteResponse {
  success: boolean;
  message: string;
}

/**
 * E2E Tests for Demo Showcase Tools
 *
 * Note: These tests require a running FrontMCP server with proper OAuth configuration.
 * The SDK requires OAuth/DCR flow to register HTTP routes.
 *
 * To run these tests:
 * 1. Start the server with proper auth: `nx serve demo-showcase`
 * 2. Run tests: `npx jest --config jest.e2e.config.ts`
 *
 * Currently skipped pending local auth implementation (see enhance-authentication PR).
 */
test.use({
  server: './src/main.ts',
  port: 3010,
  logLevel: 'debug',
});

test.describe.skip('Tools', () => {
  test.beforeEach(() => {
    // Clear the store before each test
    notesStore.clear();
  });

  test('lists all tools', async ({ mcp }) => {
    const tools = await mcp.tools.list();
    expect(tools).toContainTool('create-note');
    expect(tools).toContainTool('list-notes');
    expect(tools).toContainTool('get-note');
    expect(tools).toContainTool('delete-note');
  });

  test('creates a note successfully', async ({ mcp }) => {
    const result = await mcp.tools.call('create-note', {
      title: 'Test Note',
      content: 'Hello world',
      tags: ['test', 'demo'],
    });

    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent();

    const data = result.json<NoteResponse>();
    expect(data.id).toBeDefined();
    expect(data.title).toBe('Test Note');
    expect(data.content).toBe('Hello world');
    expect(data.tags).toEqual(['test', 'demo']);
  });

  test('lists notes', async ({ mcp }) => {
    // Create some notes first
    await mcp.tools.call('create-note', {
      title: 'Note 1',
      content: 'Content 1',
      tags: ['work'],
    });
    await mcp.tools.call('create-note', {
      title: 'Note 2',
      content: 'Content 2',
      tags: ['personal'],
    });

    const result = await mcp.tools.call('list-notes', {});
    expect(result).toBeSuccessful();

    const data = result.json<NotesListResponse>();
    expect(data.notes).toHaveLength(2);
    expect(data.count).toBe(2);
  });

  test('lists notes with tag filter', async ({ mcp }) => {
    await mcp.tools.call('create-note', {
      title: 'Work Note',
      content: 'Work content',
      tags: ['work'],
    });
    await mcp.tools.call('create-note', {
      title: 'Personal Note',
      content: 'Personal content',
      tags: ['personal'],
    });

    const result = await mcp.tools.call('list-notes', { tag: 'work' });
    expect(result).toBeSuccessful();

    const data = result.json<NotesListResponse>();
    expect(data.notes).toHaveLength(1);
    expect(data.notes[0].title).toBe('Work Note');
  });

  test('gets a note by id', async ({ mcp }) => {
    const createResult = await mcp.tools.call('create-note', {
      title: 'Test Note',
      content: 'Test content',
    });
    const { id } = createResult.json<NoteResponse>();

    const result = await mcp.tools.call('get-note', { id });
    expect(result).toBeSuccessful();

    const data = result.json<NoteResponse>();
    expect(data.id).toBe(id);
    expect(data.title).toBe('Test Note');
  });

  test('deletes a note', async ({ mcp }) => {
    const createResult = await mcp.tools.call('create-note', {
      title: 'To Delete',
      content: 'Will be deleted',
    });
    const { id } = createResult.json<NoteResponse>();

    const deleteResult = await mcp.tools.call('delete-note', { id });
    expect(deleteResult).toBeSuccessful();

    const data = deleteResult.json<DeleteResponse>();
    expect(data.success).toBe(true);

    // Verify it's deleted
    const listResult = await mcp.tools.call('list-notes', {});
    expect(listResult.json<NotesListResponse>().notes).toHaveLength(0);
  });

  test('handles invalid input for create-note', async ({ mcp }) => {
    const result = await mcp.tools.call('create-note', {});
    expect(result).toBeError(-32602); // Invalid params
  });

  test('handles non-existent note for get-note', async ({ mcp }) => {
    const result = await mcp.tools.call('get-note', { id: 'non-existent' });
    expect(result).toBeError();
  });
});
