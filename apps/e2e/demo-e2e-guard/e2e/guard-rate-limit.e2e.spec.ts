/**
 * E2E Tests for Guard — Rate Limiting
 *
 * Tests sliding window rate limiting behavior:
 * - Requests within limit succeed
 * - Requests exceeding limit are rejected
 * - Rate limit resets after window expires
 * - Different tools have separate rate limits
 *
 * Each describe block starts a fresh server to ensure clean rate limit state.
 */
import { test, expect } from '@frontmcp/testing';

test.describe('Guard Rate Limit — Basic', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-guard/src/main.ts',
    project: 'demo-e2e-guard',
    publicMode: true,
  });

  test('should allow requests within the limit and reject exceeding ones', async ({ mcp }) => {
    // rate-limited tool allows 3 requests per 5 seconds
    for (let i = 0; i < 3; i++) {
      const result = await mcp.tools.call('rate-limited', { message: `req-${i}` });
      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent(`req-${i}`);
    }

    // 4th request should be rate-limited
    const blocked = await mcp.tools.call('rate-limited', { message: 'over-limit' });
    expect(blocked).toBeError();

    // Error should mention rate limit
    const text = JSON.stringify(blocked);
    expect(text.toLowerCase()).toMatch(/rate.limit|retry|too.many/i);
  });
});

test.describe('Guard Rate Limit — Per-Tool Isolation', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-guard/src/main.ts',
    project: 'demo-e2e-guard',
    publicMode: true,
  });

  test('should maintain separate limits per tool', async ({ mcp }) => {
    // Exhaust rate-limited tool (3 requests)
    for (let i = 0; i < 3; i++) {
      const warmUp = await mcp.tools.call('rate-limited', { message: `req-${i}` });
      expect(warmUp).toBeSuccessful();
    }

    // rate-limited should now be blocked
    const blockedResult = await mcp.tools.call('rate-limited', { message: 'blocked' });
    expect(blockedResult).toBeError();

    // unguarded tool should still work (no per-tool rate limit)
    const unguardedResult = await mcp.tools.call('unguarded', { value: 'still-works' });
    expect(unguardedResult).toBeSuccessful();
    expect(unguardedResult).toHaveTextContent('still-works');
  });
});

test.describe('Guard Rate Limit — Window Reset', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-guard/src/main.ts',
    project: 'demo-e2e-guard',
    publicMode: true,
  });

  test('should reset after window expires', async ({ mcp }) => {
    // Exhaust the limit (3 requests in 5s window)
    for (let i = 0; i < 3; i++) {
      const warmUp = await mcp.tools.call('rate-limited', { message: `req-${i}` });
      expect(warmUp).toBeSuccessful();
    }

    // Should be blocked now
    const blocked = await mcp.tools.call('rate-limited', { message: 'blocked' });
    expect(blocked).toBeError();

    // Poll until rate limit resets (5s window + margin)
    const deadline = Date.now() + 7000;
    let result;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      result = await mcp.tools.call('rate-limited', { message: 'after-reset' });
      if (result && !JSON.stringify(result).includes('isError')) break;
    }
    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent('after-reset');
  });
});
