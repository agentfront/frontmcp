/**
 * E2E Tests for Environment Awareness — NODE_ENV=development
 *
 * Starts a separate server instance with NODE_ENV=development to verify
 * that env-based availableWhen constraints flip correctly when the
 * environment changes.
 *
 * The default spec runs with NODE_ENV=test (set by Jest).
 * This spec proves the same server with a different NODE_ENV
 * exposes a different set of tools.
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Environment Awareness — NODE_ENV=development', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-env-awareness/src/main.ts',
    project: 'demo-e2e-env-awareness-dev',
    publicMode: true,
    env: { NODE_ENV: 'development' },
  });

  test('should list development_only_tool when NODE_ENV=development', async ({ mcp }) => {
    const tools = await mcp.tools.list();
    const names = tools.map((t) => t.name);

    expect(names).toContain('development_only_tool');
  });

  test('should NOT list test_env_only_tool when NODE_ENV=development', async ({ mcp }) => {
    const tools = await mcp.tools.list();
    const names = tools.map((t) => t.name);

    expect(names).not.toContain('test_env_only_tool');
  });

  test('should NOT list production_only_tool when NODE_ENV=development', async ({ mcp }) => {
    const tools = await mcp.tools.list();
    const names = tools.map((t) => t.name);

    expect(names).not.toContain('production_only_tool');
  });

  test('should execute development_only_tool when NODE_ENV=development', async ({ mcp }) => {
    const result = await mcp.tools.call('development_only_tool', { msg: 'debug' });

    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent('development');
  });

  test('should return error calling test_env_only_tool when NODE_ENV=development', async ({ mcp }) => {
    const result = await mcp.tools.call('test_env_only_tool', { msg: 'nope' });

    expect(result).toBeError();
  });
});
