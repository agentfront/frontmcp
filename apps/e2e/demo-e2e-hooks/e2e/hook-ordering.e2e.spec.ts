/**
 * E2E: `before` orders two plugins whatever their priorities, an `appliesTo: 'all-apps'` hook runs for another app's
 * tool, and only a dev-mode server adds the hooks a call ran to `_meta['frontmcp/trace']`.
 */
import { expect, test } from '@frontmcp/testing';

const SERVER = 'apps/e2e/demo-e2e-hooks/src/main.hook-ordering.ts';
const TRACE = 'frontmcp/trace';

// Production refuses the development session secret fallback
const PRODUCTION = { NODE_ENV: 'production', MCP_SESSION_SECRET: 'hook-ordering-e2e-session-secret-0123456789' };

test.describe('Hook ordering E2E', () => {
  test.use({ server: SERVER, project: 'demo-e2e-hooks', publicMode: true, env: PRODUCTION });

  test('runs a plugin whose before names another plugin first, whatever their priorities', async ({ mcp }) => {
    const result = await mcp.tools.call('ordered-run', {});

    expect(result).toBeSuccessful();
    expect(result.json<{ ran: string[] }>().ran).toEqual(['tenant-resolver', 'quota-gate', 'audit-trail']);
  });

  test("runs one app's all-apps hook for a second app's tool", async ({ mcp }) => {
    const result = await mcp.tools.call('second-run', {});

    expect(result).toBeSuccessful();
    expect(result.json<{ ran: string[] }>().ran).toEqual(['audit-trail']);
  });

  test('leaves the hook trace out of the answer outside dev mode', async ({ mcp }) => {
    const result = await mcp.tools.call('ordered-run', {});

    expect(result).toBeSuccessful();
    expect(result.raw._meta?.[TRACE]).toBeUndefined();
  });
});

test.describe('Hook ordering E2E in dev mode', () => {
  test.use({ server: SERVER, project: 'demo-e2e-hooks', publicMode: true, env: { NODE_ENV: 'development' } });

  test('lists the hooks of the call in _meta in the order they ran, with no arguments or answers', async ({ mcp }) => {
    const result = await mcp.tools.call('ordered-run', {});

    expect(result).toBeSuccessful();
    const step = (owner: string, method: string) => ({
      owner,
      method,
      stage: 'execute',
      type: 'will',
      ms: expect.any(Number),
      outcome: 'ok',
    });
    expect(result.raw._meta?.[TRACE]).toEqual([
      step('tenant-resolver', 'resolveTenant'),
      step('quota-gate', 'checkQuota'),
      step('audit-trail', 'audit'),
    ]);
  });
});
