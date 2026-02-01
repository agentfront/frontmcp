/**
 * Memory Leak Detection Tests for Skills System
 *
 * Tests memory leak detection on repeated skill operations
 */
import { perfTest, expect } from '@frontmcp/testing';

perfTest.describe('Skills Leak Detection', () => {
  perfTest.use({
    server: 'apps/e2e/demo-e2e-skills/src/main.ts',
    project: 'demo-e2e-skills',
    publicMode: true,
  });

  perfTest('no memory leak on repeated loadSkills calls', async ({ mcp, perf }) => {
    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.call('loadSkills', {
          skillIds: ['review-pr'],
        });
      },
      {
        iterations: 150,
        threshold: 30 * 1024 * 1024, // 30MB - accounts for allocation without GC
        warmupIterations: 10,
        intervalSize: 50,
      },
    );

    // Check growth rate is reasonable (< 200KB/iter is acceptable)
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('no memory leak on repeated searchSkills calls', async ({ mcp, perf }) => {
    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.call('searchSkills', {
          query: 'test',
        });
      },
      {
        iterations: 150,
        threshold: 30 * 1024 * 1024, // 30MB
        warmupIterations: 10,
        intervalSize: 50,
      },
    );

    // Check growth rate is reasonable (< 200KB/iter is acceptable)
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('no memory leak on mixed skill operations', async ({ mcp, perf }) => {
    let callIndex = 0;
    const result = await perf.checkLeak(
      async () => {
        if (callIndex % 2 === 0) {
          await mcp.tools.call('loadSkills', {
            skillIds: ['review-pr', 'notify-team'],
          });
        } else {
          await mcp.tools.call('searchSkills', {
            query: 'deploy',
          });
        }
        callIndex++;
      },
      {
        iterations: 200,
        threshold: 40 * 1024 * 1024, // 40MB - more iterations
        warmupIterations: 10,
        intervalSize: 50,
      },
    );

    // Check growth rate is reasonable (< 200KB/iter is acceptable)
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });
});
