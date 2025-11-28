import { test, expect } from '@frontmcp/testing';
import { notesStore, Note } from '../src/apps/notes/data/store';

/** Response types for notes resources */
type NoteResponse = Note;
interface NotesListResourceResponse {
  notes: Note[];
  count: number;
  fetchedAt: string;
}
interface NoteNotFoundResponse {
  error: string;
  noteId: string;
}

/**
 * E2E Tests for Demo Showcase Resources
 *
 * These tests use public mode - no authentication required.
 * Server runs with `auth: { mode: 'public' }` which creates
 * stateful sessions with short TTL, suitable for CI/CD pipelines.
 */
test.use({
  server: './src/main.ts',
  port: 3011,
  publicMode: true, // Skip authentication - server is in public mode
});

test.describe('Resources', () => {
  test.beforeEach(() => {
    notesStore.clear();
  });

  test('lists resources', async ({ mcp }) => {
    const resources = await mcp.resources.list();
    expect(resources).toContainResource('notes://all');
  });

  test('lists resource templates', async ({ mcp }) => {
    const templates = await mcp.resources.listTemplates();
    expect(templates).toContainResourceTemplate('notes://note/{noteId}');
  });

  test('reads notes list resource', async ({ mcp }) => {
    // Add some notes first
    await mcp.tools.call('create-note', {
      title: 'Test Note',
      content: 'Test content',
    });

    const content = await mcp.resources.read('notes://all');
    expect(content).toHaveMimeType('application/json');

    const data = content.json<NotesListResourceResponse>();
    expect(data.notes).toHaveLength(1);
    expect(data.count).toBe(1);
    expect(data.fetchedAt).toBeDefined();
  });

  test('reads empty notes list', async ({ mcp }) => {
    const content = await mcp.resources.read('notes://all');
    expect(content).toHaveMimeType('application/json');

    const data = content.json<NotesListResourceResponse>();
    expect(data.notes).toHaveLength(0);
    expect(data.count).toBe(0);
  });

  test('reads note by id', async ({ mcp }) => {
    const createResult = await mcp.tools.call('create-note', {
      title: 'Test Note',
      content: 'Test content',
      tags: ['test'],
    });
    const { id } = createResult.json<NoteResponse>();

    const content = await mcp.resources.read(`notes://note/${id}`);
    expect(content).toHaveMimeType('application/json');

    const data = content.json<NoteResponse>();
    expect(data.id).toBe(id);
    expect(data.title).toBe('Test Note');
    expect(data.content).toBe('Test content');
    expect(data.tags).toEqual(['test']);
  });

  test('reads non-existent note returns error object', async ({ mcp }) => {
    const content = await mcp.resources.read('notes://note/non-existent');
    expect(content).toHaveMimeType('application/json');

    const data = content.json<NoteNotFoundResponse>();
    expect(data.error).toBe('Note not found');
    expect(data.noteId).toBe('non-existent');
  });
});
