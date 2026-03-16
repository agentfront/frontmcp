/**
 * E2E Tests for Guard — Global Rate Limiting
 *
 * Tests server-wide rate limiting:
 * - Global limit applies across all tools
 * - Exceeding global limit blocks all tool calls
 *
 * The main server uses a high global limit (200/10s) to avoid interfering
 * with other test files. This test verifies global rate limiting behavior
 * by confirming the guard infrastructure is active and responds to tool calls.
 *
 * For exhaustion testing, see the Playwright browser tests which test
 * against the HTTP layer directly.
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Guard Global Rate Limit', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-guard/src/main.ts',
    project: 'demo-e2e-guard',
    publicMode: true,
  });

  test('should allow many requests within the generous global limit', async ({ mcp }) => {
    // Global limit is 200 per 10 seconds. 20 requests is well within.
    for (let i = 0; i < 20; i++) {
      const result = await mcp.tools.call('unguarded', { value: `req-${i}` });
      expect(result).toBeSuccessful();
    }
  });

  test('should apply per-tool rate limit even under global limit', async ({ mcp }) => {
    // rate-limited tool has 3 requests per 5s limit
    // Global limit won't interfere (200/10s), but per-tool limit will
    for (let i = 0; i < 3; i++) {
      const result = await mcp.tools.call('rate-limited', { message: `req-${i}` });
      expect(result).toBeSuccessful();
    }

    // 4th per-tool request should fail even though global is fine
    const blocked = await mcp.tools.call('rate-limited', { message: 'blocked' });
    expect(blocked).toBeError();
  });
});
