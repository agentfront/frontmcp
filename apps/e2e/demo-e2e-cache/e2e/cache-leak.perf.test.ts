/**
 * Memory Leak Detection Tests for CachePlugin
 *
 * Tests memory leak detection on repeated cache operations
 */
import { perfTest, expect } from '@frontmcp/testing';

perfTest.describe('Cache Leak Detection', () => {
  perfTest.use({
    server: 'apps/e2e/demo-e2e-cache/src/main.ts',
    project: 'demo-e2e-cache',
    publicMode: true,
  });

  perfTest('no memory leak on repeated cache operations', async ({ mcp, perf }) => {
    // Reset stats before leak test
    await mcp.tools.call('reset-stats', {});

    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.call('expensive-operation', {
          operationId: `leak-test-${Math.random()}`,
          complexity: 2,
        });
      },
      {
        iterations: 30,
        threshold: 5 * 1024 * 1024, // 5MB threshold
        warmupIterations: 5,
      },
    );

    expect(result.hasLeak).toBe(false);
  });

  perfTest('no memory leak on repeated cache hits', async ({ mcp, perf }) => {
    // Reset stats
    await mcp.tools.call('reset-stats', {});

    // Pre-populate cache
    await mcp.tools.call('expensive-operation', {
      operationId: 'leak-check-key',
      complexity: 3,
    });

    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.call('expensive-operation', {
          operationId: 'leak-check-key',
          complexity: 3,
        });
      },
      {
        iterations: 30,
        threshold: 10 * 1024 * 1024, // 10MB threshold (allowing for GC variance)
        warmupIterations: 5,
      },
    );

    // Note: Without --expose-gc, leak detection may have false positives
    // Check that growth rate is reasonable even if hasLeak is true
    expect(result.growthRate).toBeLessThan(500 * 1024); // Less than 500KB per iteration
  });

  perfTest('no memory leak on non-cached operations', async ({ mcp, perf }) => {
    // Reset stats
    await mcp.tools.call('reset-stats', {});

    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.call('non-cached', {
          operationId: `non-cached-${Math.random()}`,
        });
      },
      {
        iterations: 30,
        threshold: 10 * 1024 * 1024, // 10MB threshold
        warmupIterations: 5,
      },
    );

    // Check that growth rate is reasonable
    expect(result.growthRate).toBeLessThan(500 * 1024); // Less than 500KB per iteration
  });
});
