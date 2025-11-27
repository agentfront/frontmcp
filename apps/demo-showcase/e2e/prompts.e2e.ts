import { test, expect } from '@frontmcp/testing';
import { notesStore } from '../src/apps/notes/data/store';

/**
 * E2E Tests for Demo Showcase Prompts
 *
 * Note: These tests require a running FrontMCP server with proper OAuth configuration.
 * Currently skipped pending local auth implementation (see enhance-authentication PR).
 */
test.use({
  server: './src/main.ts',
  port: 3012,
});

test.describe.skip('Prompts', () => {
  test.beforeEach(() => {
    notesStore.clear();
  });

  test('lists prompts', async ({ mcp }) => {
    const prompts = await mcp.prompts.list();
    expect(prompts).toContainPrompt('summarize-notes');
    expect(prompts).toContainPrompt('create-note-draft');
  });

  test('gets summarize-notes prompt', async ({ mcp }) => {
    // Add some notes first
    await mcp.tools.call('create-note', {
      title: 'Work Task',
      content: 'Complete the project documentation',
      tags: ['work'],
    });

    const result = await mcp.prompts.get('summarize-notes', { tag: 'work' });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');

    // Check that the prompt content mentions the notes
    const content = result.messages[0].content;
    expect(content.type).toBe('text');
    if (content.type === 'text') {
      expect(content.text).toContain('work');
      expect(content.text).toContain('summarize');
    }
  });

  test('gets summarize-notes prompt with empty notes', async ({ mcp }) => {
    const result = await mcp.prompts.get('summarize-notes', {});

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');

    const content = result.messages[0].content;
    expect(content.type).toBe('text');
    if (content.type === 'text') {
      expect(content.text).toContain('No notes found');
    }
  });

  test('gets create-note-draft prompt', async ({ mcp }) => {
    const result = await mcp.prompts.get('create-note-draft', {
      topic: 'TypeScript Best Practices',
      style: 'technical',
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');

    const content = result.messages[0].content;
    expect(content.type).toBe('text');
    if (content.type === 'text') {
      expect(content.text).toContain('TypeScript Best Practices');
      expect(content.text).toContain('technical');
    }
  });

  test('gets create-note-draft prompt with default style', async ({ mcp }) => {
    const result = await mcp.prompts.get('create-note-draft', {
      topic: 'Meeting Notes',
    });

    expect(result.messages).toHaveLength(1);

    const content = result.messages[0].content;
    expect(content.type).toBe('text');
    if (content.type === 'text') {
      expect(content.text).toContain('Meeting Notes');
      expect(content.text).toContain('casual'); // Default style
    }
  });
});
