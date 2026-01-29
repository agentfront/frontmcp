/**
 * Sequential Stress Tests for UI System (1000 iterations)
 *
 * Tests UI rendering operations under sustained sequential load
 */
import { perfTest, expect } from '@frontmcp/testing';

perfTest.describe('UI Sequential Stress Testing', () => {
  perfTest.use({
    server: 'apps/e2e/demo-e2e-ui/src/main.ts',
    project: 'demo-e2e-ui',
    publicMode: true,
  });

  perfTest('stress test: 1000 html-table operations', async ({ mcp, perf }) => {
    let counter = 0;
    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.call('html-table', {
          headers: ['ID', 'Name', 'Status'],
          rows: [
            [`${counter}`, `Item ${counter}`, 'active'],
            [`${counter + 1}`, `Item ${counter + 1}`, 'pending'],
          ],
          title: `Table ${counter++}`,
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
      `[STRESS] html-table: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    // Check growth rate is reasonable (< 200KB/iter)
    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('stress test: 1000 markdown-report operations', async ({ mcp, perf }) => {
    let counter = 0;
    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.call('markdown-report', {
          title: `Report ${counter}`,
          sections: [
            { heading: 'Summary', content: `Summary content ${counter}` },
            { heading: 'Details', content: `Details content ${counter++}` },
          ],
        });
      },
      {
        iterations: 1000,
        threshold: 100 * 1024 * 1024, // 100MB
        warmupIterations: 20,
        intervalSize: 100,
      },
    );

    console.log(
      `[STRESS] markdown-report: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('stress test: 1000 static-badge operations', async ({ mcp, perf }) => {
    const badges = ['success', 'warning', 'error', 'info'];
    let counter = 0;
    const result = await perf.checkLeak(
      async () => {
        await mcp.tools.call('static-badge', {
          label: `Badge ${counter}`,
          status: badges[counter++ % badges.length],
        });
      },
      {
        iterations: 1000,
        threshold: 100 * 1024 * 1024, // 100MB
        warmupIterations: 20,
        intervalSize: 100,
      },
    );

    console.log(
      `[STRESS] static-badge: ${result.requestsPerSecond?.toFixed(1)} req/s, ${result.samples.length} iterations`,
    );

    expect(result.growthRate).toBeLessThan(200 * 1024);
  });

  perfTest('stress test: 1000 mixed UI operations', async ({ mcp, perf }) => {
    let callIndex = 0;
    const result = await perf.checkLeak(
      async () => {
        const op = callIndex++ % 3;
        if (op === 0) {
          await mcp.tools.call('html-table', {
            headers: ['Col1', 'Col2'],
            rows: [
              ['A', 'B'],
              ['C', 'D'],
            ],
          });
        } else if (op === 1) {
          await mcp.tools.call('markdown-report', {
            title: `Report ${callIndex}`,
            sections: [{ heading: 'Section', content: 'Content' }],
          });
        } else {
          await mcp.tools.call('static-badge', {
            label: 'Status',
            status: 'success',
          });
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
