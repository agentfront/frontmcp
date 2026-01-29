/**
 * Sequential Stress Tests for Public Auth System (1000 iterations)
 *
 * Tests public mode operations under sustained sequential load
 */
import { perfTest, expect } from '@frontmcp/testing';

perfTest.describe('Public Sequential Stress Testing', () => {
  perfTest.use({
    server: 'apps/e2e/demo-e2e-public/src/main.ts',
    project: 'demo-e2e-public',
    publicMode: true,
  });

  perfTest('stress test: 1000 create-note operations', async ({ mcp, perf }) => {
    let counter = 0;
    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.call('create-note', {
          title: `Note ${counter}`,
          content: `Content for note ${counter++}`,
        });
      },
      {
        iterations: 1000,
        threshold: 100 * 1024 * 1024, // 100MB for 1000 iterations
        warmupIterations: 20,
        intervalSize: 100,
      },
    );

    // Log performance stats
    console.log(
      `[STRESS] create-note: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    // Check growth rate is reasonable (< 200KB/iter)
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('stress test: 1000 list-notes operations', async ({ mcp, perf }) => {
    // Reset store before leak check to prevent accumulated data from previous tests
    await mcp.tools.call('notes-reset', {});

    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.call('list-notes', {});
      },
      {
        iterations: 1000,
        threshold: 100 * 1024 * 1024, // 100MB
        warmupIterations: 20,
        intervalSize: 100,
      },
    );

    console.log(
      `[STRESS] list-notes: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('stress test: 1000 mixed operations', async ({ mcp, perf }) => {
    // Reset store before leak check to prevent accumulated data from previous tests
    await mcp.tools.call('notes-reset', {});

    let callIndex = 0;
    const result = await perf.checkLeak(
      async () => {
        const op = callIndex++ % 2;
        if (op === 0) {
          await mcp.tools.call('create-note', { title: `Note ${callIndex}`, content: `Content ${callIndex}` });
        } else {
          await mcp.tools.call('list-notes', {});
        }
      },
      {
        iterations: 1000,
        threshold: 100 * 1024 * 1024, // 100MB
        warmupIterations: 20,
        intervalSize: 100,
      },
    );

    console.log(
      `[STRESS] mixed operations: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('stress test: 1000 tool listings', async ({ mcp, perf }) => {
    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.list();
      },
      {
        iterations: 1000,
        threshold: 100 * 1024 * 1024, // 100MB
        warmupIterations: 20,
        intervalSize: 100,
      },
    );

    console.log(
      `[STRESS] tools.list: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    expect(result.growthRate).toBeLessThan(200 * 1024);
  });
});
