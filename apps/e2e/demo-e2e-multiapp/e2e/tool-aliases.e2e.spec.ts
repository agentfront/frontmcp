/**
 * E2E: `@Tool({ aliases })`.
 *
 * The review app's `review_list` was renamed from `review.list` and keeps that name as an alias. The
 * same app has a tool named `list`, so `review.list` also reads as the owner name `review:list`: the
 * alias wins. `alias-collision.main.ts` adds a second tool claiming the alias, which fails startup.
 */
import { expect, test, TestServer } from '@frontmcp/testing';

test.describe('Tool aliases E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-multiapp/src/main.ts',
    project: 'demo-e2e-multiapp',
    publicMode: true,
  });

  test('calls review_list by its old dotted name', async ({ mcp }) => {
    const result = await mcp.tools.call('review.list', {});

    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent('PR-17 waits for a second approval');
  });

  test('does not list the alias', async ({ mcp }) => {
    const tools = await mcp.tools.list();

    expect(tools).toContainTool('review_list');
    expect(tools.map((tool) => tool.name)).not.toContain('review.list');
  });

  test('reads review.list as the alias before reading it as review:list', async ({ mcp }) => {
    const byAlias = await mcp.tools.call('review.list', {});
    const byFullName = await mcp.tools.call('review:list', {});

    expect(byAlias).toHaveTextContent('reviews');
    expect(byAlias).not.toHaveTextContent('queues');
    expect(byFullName).toBeSuccessful();
    expect(byFullName).toHaveTextContent('queues');
  });
});

describe('Tool alias collision E2E', () => {
  it('fails startup when two tools claim one alias', async () => {
    const started = TestServer.start({
      command: 'npx tsx apps/e2e/demo-e2e-multiapp/src/alias-collision.main.ts',
      project: 'demo-e2e-multiapp',
      startupTimeout: 60000,
    });

    await expect(started).rejects.toThrow(
      /alias "review\.list" is declared by both "review:review_list" and "archive:archived_reviews"/,
    );
  });
});
