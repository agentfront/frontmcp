/**
 * E2E: an agent's model reads the resources and prompts the agent declares (#699).
 *
 * The librarian agent declares resources and prompts it does not export. Its mock model calls the
 * built-in tool its input names and answers with what it read, so each test drives one read through
 * the server and checks what the model got.
 */
import { expect, test } from '@frontmcp/testing';

interface LibrarianOutput {
  read: string;
  tools: string[];
  audited: string[];
}

test.describe('Agent resources and prompts E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-agents/src/main.ts',
    project: 'demo-e2e-agents',
    publicMode: true,
  });

  test('offers the model the built-in tools for what the agent declares', async ({ mcp }) => {
    const result = await mcp.tools.call('invoke_librarian-agent', { tool: 'list_resources' });

    expect(result).toBeSuccessful();
    expect(result.json<LibrarianOutput>().tools).toEqual([
      'get_prompt',
      'list_prompts',
      'list_resources',
      'read_resource',
    ]);
  });

  test('lists the resources and resource templates', async ({ mcp }) => {
    const result = await mcp.tools.call('invoke_librarian-agent', { tool: 'list_resources' });

    expect(JSON.parse(result.json<LibrarianOutput>().read)).toEqual({
      resources: [
        { uri: 'library://shelf', name: 'shelf', description: 'What is on the shelf', mimeType: 'text/plain' },
      ],
      resourceTemplates: [{ uriTemplate: 'library://books/{id}', name: 'book', mimeType: 'text/plain' }],
    });
  });

  test("reads a resource through the agent scope's flow, whose hooks run", async ({ mcp }) => {
    const result = await mcp.tools.call('invoke_librarian-agent', {
      tool: 'read_resource',
      args: { uri: 'library://shelf' },
    });

    const output = result.json<LibrarianOutput>();
    expect(output.read).toBe('three books');
    expect(output.audited[output.audited.length - 1]).toBe('library://shelf');
  });

  test('reads a resource template', async ({ mcp }) => {
    const result = await mcp.tools.call('invoke_librarian-agent', {
      tool: 'read_resource',
      args: { uri: 'library://books/7' },
    });

    expect(result.json<LibrarianOutput>().read).toBe('Book 7');
  });

  test('gets a prompt as text', async ({ mcp }) => {
    const result = await mcp.tools.call('invoke_librarian-agent', {
      tool: 'get_prompt',
      args: { name: 'greeting', arguments: { visitor: 'Ada' } },
    });

    expect(result.json<LibrarianOutput>().read).toBe('[user]\nWelcome, Ada');
  });

  test('answers an unknown URI as a tool error the model reads', async ({ mcp }) => {
    const result = await mcp.tools.call('invoke_librarian-agent', {
      tool: 'read_resource',
      args: { uri: 'library://missing' },
    });

    expect(result).toBeSuccessful();
    expect(JSON.parse(result.json<LibrarianOutput>().read)).toEqual({ error: 'Resource not found: library://missing' });
  });

  test('keeps the resources and prompts the agent does not export from clients', async ({ mcp }) => {
    const resources = await mcp.resources.list();
    const prompts = await mcp.prompts.list();

    expect(resources.map((resource) => resource.uri)).not.toContain('library://shelf');
    expect(prompts.map((prompt) => prompt.name)).not.toContain('greeting');
  });
});
