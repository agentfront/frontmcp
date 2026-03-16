/**
 * E2E Tests for Guard — Execution Timeout
 *
 * Tests timeout behavior:
 * - Fast execution within timeout succeeds
 * - Slow execution exceeding timeout is killed
 * - Default app timeout applies to tools without explicit config
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Guard Timeout', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-guard/src/main.ts',
    project: 'demo-e2e-guard',
    publicMode: true,
  });

  test('should succeed when execution completes within timeout', async ({ mcp }) => {
    // timeout-tool has 500ms timeout, 100ms delay is well within
    const result = await mcp.tools.call('timeout-tool', { delayMs: 100 });
    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent('done');
  });

  test('should timeout when execution exceeds deadline', async ({ mcp }) => {
    // timeout-tool has 500ms timeout, 1000ms delay exceeds it
    const result = await mcp.tools.call('timeout-tool', { delayMs: 1000 });
    expect(result).toBeError();
    const text = JSON.stringify(result);
    expect(text.toLowerCase()).toMatch(/timeout|timed.out/i);
  });

  test('should succeed with default timeout when under limit', async ({ mcp }) => {
    // slow-tool has no explicit timeout, inherits app default of 5000ms
    // 100ms delay is well within
    const result = await mcp.tools.call('slow-tool', { delayMs: 100 });
    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent('100');
  });

  test('should timeout with default timeout when over limit', async ({ mcp }) => {
    // slow-tool inherits 5000ms default timeout, 6000ms exceeds it
    const result = await mcp.tools.call('slow-tool', { delayMs: 6000 });
    expect(result).toBeError();
    const text = JSON.stringify(result);
    expect(text.toLowerCase()).toMatch(/timeout|timed.out/i);
  });
});
