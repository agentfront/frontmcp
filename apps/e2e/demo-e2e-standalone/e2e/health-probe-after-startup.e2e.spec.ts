/**
 * E2E: a check added with `scope.registerHealthProbe()` after the server started runs on the next /readyz, over
 * real HTTP, and the function it returns takes it off again.
 */
import { expect, test } from '@frontmcp/testing';

interface Readiness {
  httpStatus: number;
  status: string;
  probes?: Record<string, { status: string; error?: string }>;
}

async function readiness(baseUrl: string): Promise<Readiness> {
  const response = await fetch(`${baseUrl}/readyz`);
  return { httpStatus: response.status, ...((await response.json()) as Omit<Readiness, 'httpStatus'>) };
}

test.describe('A /readyz check registered after startup', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-standalone/src/main-health-probes.ts',
    project: 'demo-e2e-standalone',
    publicMode: true,
  });

  test.afterEach(async ({ mcp }) => {
    await mcp.tools.call('stop-late-feature', {});
  });

  test('runs on the next /readyz, which answers 503 while it fails', async ({ mcp, server }) => {
    const before = await readiness(server.info.baseUrl);

    expect(await mcp.tools.call('start-late-feature', { healthy: false })).toBeSuccessful();
    const after = await readiness(server.info.baseUrl);

    expect(before).toMatchObject({ httpStatus: 200, status: 'ready' });
    expect(before.probes).not.toHaveProperty('late-feature');
    expect(after).toMatchObject({ httpStatus: 503, status: 'not_ready' });
    expect(after.probes?.['late-feature']).toEqual({ status: 'unhealthy', error: 'the late feature is down' });
  });

  test('is taken off /readyz by the function registerHealthProbe returned', async ({ mcp, server }) => {
    await mcp.tools.call('start-late-feature', { healthy: true });
    const running = await readiness(server.info.baseUrl);

    expect(await mcp.tools.call('stop-late-feature', {})).toBeSuccessful();
    const stopped = await readiness(server.info.baseUrl);

    expect(running).toMatchObject({ httpStatus: 200, probes: { 'late-feature': { status: 'healthy' } } });
    expect(stopped).toMatchObject({ httpStatus: 200, status: 'ready' });
    expect(stopped.probes).not.toHaveProperty('late-feature');
  });
});
