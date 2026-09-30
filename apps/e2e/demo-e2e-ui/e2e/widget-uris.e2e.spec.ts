/**
 * E2E: the widget URI a tool advertises in tools/list must be readable, and a URI no tool
 * advertises must not be answered with a placeholder widget (issue #645).
 */
import { expect, test } from '@frontmcp/testing';

test.describe('Tool UI widget URIs E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-ui/src/main.ts',
    project: 'demo-e2e-ui',
    publicMode: true,
  });

  test('a custom ui.resourceUri is advertised and readable', async ({ mcp }) => {
    const tools = await mcp.tools.list();
    const tool = tools.find((t) => t.name === 'custom-uri-widget');
    const meta = tool?._meta as { ui?: { resourceUri?: string } } | undefined;
    expect(meta?.ui?.resourceUri).toBe('ui://acme/custom-dashboard');

    const resource = await mcp.resources.read('ui://acme/custom-dashboard');
    expect(resource).toBeSuccessful();
    expect(resource.text()).toContain('custom-uri-widget');
  });

  test('an unknown ui://widget URI is not found rather than a placeholder', async ({ mcp }) => {
    const resource = await mcp.resources.read('ui://widget/no-such-tool.html');
    expect(resource).not.toBeSuccessful();
  });

  test('the standard widget URI of a UI tool still reads', async ({ mcp }) => {
    const resource = await mcp.resources.read('ui://widget/static-badge.html');
    expect(resource).toBeSuccessful();
  });
});
