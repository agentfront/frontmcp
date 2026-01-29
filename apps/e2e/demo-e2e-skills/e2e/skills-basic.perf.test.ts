/**
 * Basic Performance Tests for Skills System
 *
 * Tests basic skills performance characteristics:
 * - Skill loading memory overhead
 * - Skill search performance
 * - Format options performance
 * - Tool discovery performance
 */
import { perfTest, expect } from '@frontmcp/testing';

perfTest.describe('Skills Basic Performance', () => {
  perfTest.use({
    server: 'apps/e2e/demo-e2e-skills/src/main.ts',
    project: 'demo-e2e-skills',
    publicMode: true,
  });

  perfTest.describe('Skill Loading Performance', () => {
    perfTest('loadSkills should have bounded memory overhead', async ({ mcp, perf }) => {
      // Load skills multiple times
      for (let i = 0; i < 50; i++) {
        await mcp.tools.call('loadSkills', {
          skillIds: ['review-pr'],
        });
      }

      // Assert memory is within acceptable bounds
      perf.assertThresholds({ maxHeapDelta: 25 * 1024 * 1024 }); // 25MB
    });

    perfTest('loading multiple skills should be efficient', async ({ mcp, perf }) => {
      // Load multiple skills in single call
      for (let i = 0; i < 30; i++) {
        await mcp.tools.call('loadSkills', {
          skillIds: ['review-pr', 'notify-team', 'deploy-app'],
        });
      }

      perf.assertThresholds({
        maxHeapDelta: 30 * 1024 * 1024, // 30MB
        maxDurationMs: 60000,
      });
    });

    perfTest('loading hidden skills should be performant', async ({ mcp, perf }) => {
      for (let i = 0; i < 30; i++) {
        await mcp.tools.call('loadSkills', {
          skillIds: ['hidden-internal'],
        });
      }

      perf.assertThresholds({ maxHeapDelta: 20 * 1024 * 1024 });
    });
  });

  perfTest.describe('Skill Search Performance', () => {
    perfTest('searchSkills should be fast', async ({ mcp, perf }) => {
      // Perform many searches
      for (let i = 0; i < 50; i++) {
        await mcp.tools.call('searchSkills', {
          query: 'review',
        });
      }

      perf.assertThresholds({
        maxDurationMs: 60000,
        maxHeapDelta: 25 * 1024 * 1024,
      });
    });

    perfTest('searchSkills with various queries should be consistent', async ({ mcp, perf }) => {
      const queries = ['pr', 'deploy', 'team', 'notify', 'review', 'hidden', 'app'];

      for (let i = 0; i < 30; i++) {
        const query = queries[i % queries.length];
        await mcp.tools.call('searchSkills', { query });
      }

      perf.assertThresholds({
        maxDurationMs: 60000,
        maxHeapDelta: 20 * 1024 * 1024,
      });
    });
  });

  perfTest.describe('Format Options Performance', () => {
    perfTest('full format should be performant', async ({ mcp, perf }) => {
      for (let i = 0; i < 30; i++) {
        await mcp.tools.call('loadSkills', {
          skillIds: ['review-pr'],
          format: 'full',
        });
      }

      perf.assertThresholds({
        maxDurationMs: 60000,
        maxHeapDelta: 25 * 1024 * 1024,
      });
    });

    perfTest('instructions-only format should be lighter', async ({ mcp, perf }) => {
      for (let i = 0; i < 30; i++) {
        await mcp.tools.call('loadSkills', {
          skillIds: ['review-pr'],
          format: 'instructions-only',
        });
      }

      perf.assertThresholds({
        maxDurationMs: 60000,
        maxHeapDelta: 20 * 1024 * 1024,
      });
    });
  });

  perfTest.describe('Tool Discovery Performance', () => {
    perfTest('listing tools should be fast', async ({ mcp, perf }) => {
      for (let i = 0; i < 100; i++) {
        await mcp.tools.list();
      }

      perf.assertThresholds({
        maxDurationMs: 60000,
        maxHeapDelta: 20 * 1024 * 1024, // 20MB - listing 100 times allocates response objects
      });
    });
  });
});
