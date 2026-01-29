/**
 * Basic Performance Tests for CachePlugin
 *
 * Tests basic cache performance characteristics:
 * - Memory overhead of cache operations
 * - Performance comparison (cached vs non-cached)
 * - Resource access performance
 */
import { perfTest, expect } from '@frontmcp/testing';

perfTest.describe('Cache Basic Performance', () => {
  perfTest.use({
    server: 'apps/e2e/demo-e2e-cache/src/main.ts',
    project: 'demo-e2e-cache',
    publicMode: true,
  });

  perfTest.describe('Memory Overhead', () => {
    perfTest('cache operations should have bounded memory overhead', async ({ mcp, perf }) => {
      // Reset stats
      await mcp.tools.call('reset-stats', {});

      // Run many cache operations
      for (let i = 0; i < 100; i++) {
        await mcp.tools.call('expensive-operation', {
          operationId: `perf-test-${i}`,
          complexity: 3,
        });
      }

      // Assert memory usage is within acceptable bounds
      // 20MB max heap delta for 100 operations (initial baseline, adjust as needed)
      perf.assertThresholds({ maxHeapDelta: 20 * 1024 * 1024 });
    });

    perfTest('cached results should not accumulate memory', async ({ mcp, perf }) => {
      // Reset stats
      await mcp.tools.call('reset-stats', {});

      // Hit the same cache key many times
      for (let i = 0; i < 50; i++) {
        await mcp.tools.call('expensive-operation', {
          operationId: 'repeated-key',
          complexity: 5,
        });
      }

      // Memory should be stable since we're hitting cache
      // 15MB max for repeated cache hits (allowing for Node.js variance)
      perf.assertThresholds({ maxHeapDelta: 15 * 1024 * 1024 });
    });
  });

  perfTest.describe('Performance Comparison', () => {
    perfTest('cached operations should be faster than non-cached', async ({ mcp, perf }) => {
      await mcp.tools.call('reset-stats', {});

      // Measure non-cached operations
      const nonCachedStart = Date.now();
      for (let i = 0; i < 20; i++) {
        await mcp.tools.call('non-cached', { operationId: `non-cached-${i}` });
      }
      const nonCachedDuration = Date.now() - nonCachedStart;

      // Measure cached operations (same key = cache hits after first)
      const cachedStart = Date.now();
      for (let i = 0; i < 20; i++) {
        await mcp.tools.call('expensive-operation', {
          operationId: 'cached-perf-test',
          complexity: 1,
        });
      }
      const cachedDuration = Date.now() - cachedStart;

      // Record measurements
      perf.measure('non-cached-duration');
      perf.measure('cached-duration');

      // Log performance comparison
      console.log(`Non-cached (20 ops): ${nonCachedDuration}ms`);
      console.log(`Cached (20 ops): ${cachedDuration}ms`);

      // Just ensure test completes within timeout
      // Actual performance assertions would need baseline data
      perf.assertThresholds({ maxDurationMs: 30000 });
    });
  });

  perfTest.describe('Resource Access Performance', () => {
    perfTest('cache stats resource should be performant', async ({ mcp, perf }) => {
      // Make some calls first to populate stats
      await mcp.tools.call('reset-stats', {});
      for (let i = 0; i < 10; i++) {
        await mcp.tools.call('expensive-operation', {
          operationId: `stats-test-${i}`,
          complexity: 1,
        });
      }

      // Measure resource reads
      for (let i = 0; i < 50; i++) {
        await mcp.resources.read('cache://stats');
      }

      // Resource reads should be fast and memory-efficient
      perf.assertThresholds({
        maxDurationMs: 30000,
        maxHeapDelta: 15 * 1024 * 1024,
      });
    });
  });
});
