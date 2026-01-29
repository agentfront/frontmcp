/**
 * Basic Performance Tests for Redis Integration
 *
 * Tests basic Redis session and storage vault performance:
 * - Session create/read/update cycles
 * - Storage vault operation memory overhead
 * - Connection stability
 *
 * Note: These tests require a Redis instance running locally.
 * Skip if Redis is not available by setting SKIP_REDIS_TESTS=1
 */
import { perfTest } from '@frontmcp/testing';

const SKIP_REDIS = process.env['SKIP_REDIS_TESTS'] === '1';

perfTest.describe('Redis Basic Performance', () => {
  perfTest.use({
    server: 'apps/e2e/demo-e2e-redis/src/main.ts',
    project: 'demo-e2e-redis',
    publicMode: true,
  });

  perfTest.describe('Session Operations', () => {
    (SKIP_REDIS ? perfTest.skip : perfTest)(
      'session operations should have bounded memory overhead',
      async ({ mcp, perf }) => {
        // Perform many session operations
        for (let i = 0; i < 50; i++) {
          await mcp.tools.call('set-session-data', {
            key: `perf-key-${i}`,
            value: `perf-value-${i}`,
          });

          await mcp.tools.call('get-session-data', {
            key: `perf-key-${i}`,
          });
        }

        // Assert memory is within acceptable bounds
        perf.assertThresholds({ maxHeapDelta: 30 * 1024 * 1024 }); // 30MB
      },
    );

    (SKIP_REDIS ? perfTest.skip : perfTest)('session read operations should be fast', async ({ mcp, perf }) => {
      // Set up some data first
      await mcp.tools.call('set-session-data', {
        key: 'read-perf-key',
        value: 'read-perf-value',
      });

      // Read many times
      for (let i = 0; i < 100; i++) {
        await mcp.tools.call('get-session-data', {
          key: 'read-perf-key',
        });
      }

      perf.assertThresholds({
        maxDurationMs: 60000,
        maxHeapDelta: 25 * 1024 * 1024,
      });
    });
  });

  perfTest.describe('Storage Vault Operations', () => {
    (SKIP_REDIS ? perfTest.skip : perfTest)(
      'storage vault should handle many entries efficiently',
      async ({ mcp, perf }) => {
        // Store many items
        for (let i = 0; i < 30; i++) {
          await mcp.tools.call('vault-store', {
            key: `vault-key-${i}`,
            value: JSON.stringify({ data: `vault-data-${i}`, timestamp: Date.now() }),
          });
        }

        // Retrieve items
        for (let i = 0; i < 30; i++) {
          await mcp.tools.call('vault-retrieve', {
            key: `vault-key-${i}`,
          });
        }

        perf.assertThresholds({
          maxHeapDelta: 35 * 1024 * 1024,
          maxDurationMs: 60000,
        });
      },
    );

    (SKIP_REDIS ? perfTest.skip : perfTest)(
      'vault operations with large values should be bounded',
      async ({ mcp, perf }) => {
        // Create a moderately large value
        const largeValue = JSON.stringify({
          data: 'x'.repeat(10000), // 10KB of data
          metadata: { timestamp: Date.now() },
        });

        for (let i = 0; i < 20; i++) {
          await mcp.tools.call('vault-store', {
            key: `large-key-${i}`,
            value: largeValue,
          });
        }

        perf.assertThresholds({
          maxHeapDelta: 40 * 1024 * 1024, // Allow more for large values
          maxDurationMs: 60000,
        });
      },
    );
  });

  perfTest.describe('Connection Stability', () => {
    (SKIP_REDIS ? perfTest.skip : perfTest)(
      'rapid operations should not exhaust connections',
      async ({ mcp, perf }) => {
        // Rapid fire operations
        const operations = [];
        for (let i = 0; i < 50; i++) {
          operations.push(
            mcp.tools.call('set-session-data', {
              key: `rapid-${i}`,
              value: `value-${i}`,
            }),
          );
        }

        // Wait for all to complete
        await Promise.all(operations);

        perf.assertThresholds({
          maxDurationMs: 60000,
          maxHeapDelta: 30 * 1024 * 1024,
        });
      },
    );

    (SKIP_REDIS ? perfTest.skip : perfTest)('sustained load should maintain stable memory', async ({ mcp, perf }) => {
      // Run operations over time
      for (let batch = 0; batch < 5; batch++) {
        for (let i = 0; i < 20; i++) {
          await mcp.tools.call('set-session-data', {
            key: `sustained-${batch}-${i}`,
            value: `value-${batch}-${i}`,
          });
        }
        // Small pause between batches
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Memory should remain stable after sustained load
      perf.assertThresholds({
        maxHeapDelta: 35 * 1024 * 1024,
      });
    });
  });

  perfTest.describe('Tool Discovery', () => {
    (SKIP_REDIS ? perfTest.skip : perfTest)('listing tools should be fast', async ({ mcp, perf }) => {
      for (let i = 0; i < 100; i++) {
        await mcp.tools.list();
      }

      perf.assertThresholds({
        maxDurationMs: 60000,
        maxHeapDelta: 20 * 1024 * 1024,
      });
    });
  });
});
