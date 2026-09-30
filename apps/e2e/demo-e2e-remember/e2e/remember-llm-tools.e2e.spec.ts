/**
 * E2E Tests for the RememberPlugin LLM tools (#647)
 *
 * The server is configured with `tools: { enabled: true, prefix: 'llm_', allowedScopes: ['session', 'user'] }`.
 * That option used to crash startup, so every other spec in this app passing said nothing about it.
 */
import { expect, test } from '@frontmcp/testing';

test.describe('Remember Plugin LLM tools E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-remember/src/main.ts',
    project: 'demo-e2e-remember',
    publicMode: true,
    logLevel: 'warn',
  });

  test('registers the four memory tools under the prefix', async ({ mcp }) => {
    const tools = await mcp.tools.list();

    expect(tools).toContainTool('llm_remember_this');
    expect(tools).toContainTool('llm_recall');
    expect(tools).toContainTool('llm_forget');
    expect(tools).toContainTool('llm_list_memories');
  });

  test('stores, recalls, lists and forgets through the tools', async ({ mcp }) => {
    const stored = await mcp.tools.call('llm_remember_this', { key: 'llm-colour', value: 'green' });
    expect(stored).toBeSuccessful();

    const recalled = await mcp.tools.call('llm_recall', { key: 'llm-colour' });
    expect(recalled).toBeSuccessful();
    expect(recalled).toHaveTextContent('"found":true');
    expect(recalled).toHaveTextContent('green');

    const listed = await mcp.tools.call('llm_list_memories', {});
    expect(listed).toHaveTextContent('llm-colour');

    expect(await mcp.tools.call('llm_forget', { key: 'llm-colour' })).toBeSuccessful();
    expect(await mcp.tools.call('llm_recall', { key: 'llm-colour' })).toHaveTextContent('"found":false');
  });

  test('rejects a scope outside allowedScopes', async ({ mcp }) => {
    const result = await mcp.tools.call('llm_remember_this', { key: 'llm-global', value: 'x', scope: 'global' });

    expect(result).toBeError();
  });
});
