/**
 * Machine ID — Deployment-Aware Resolution Tests
 *
 * Tests that machine ID resolves correctly based on FRONTMCP_DEPLOYMENT_MODE:
 * - distributed: HOSTNAME (K8s pod name) > os.hostname()
 * - serverless: ephemeral UUID
 * - standalone: file persistence in dev, random in prod
 */

describe('machine-id deployment awareness', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should use MACHINE_ID env var when set (highest priority)', async () => {
    process.env['MACHINE_ID'] = 'explicit-machine-id';
    delete process.env['FRONTMCP_DEPLOYMENT_MODE'];

    const { getMachineId } = await import('../machine-id');
    expect(getMachineId()).toBe('explicit-machine-id');
  });

  it('should use HOSTNAME in distributed mode (K8s pod name)', async () => {
    delete process.env['MACHINE_ID'];
    process.env['FRONTMCP_DEPLOYMENT_MODE'] = 'distributed';
    process.env['HOSTNAME'] = 'myapp-7d9f8b6c4-x2k9p';

    const { getMachineId } = await import('../machine-id');
    expect(getMachineId()).toBe('myapp-7d9f8b6c4-x2k9p');
  });

  it('should fall back to os.hostname() in distributed mode without HOSTNAME', async () => {
    delete process.env['MACHINE_ID'];
    delete process.env['HOSTNAME'];
    process.env['FRONTMCP_DEPLOYMENT_MODE'] = 'distributed';

    const os = require('os');
    const expected = os.hostname();

    const { getMachineId } = await import('../machine-id');
    expect(getMachineId()).toBe(expected);
  });

  it('should generate ephemeral UUID in serverless mode', async () => {
    delete process.env['MACHINE_ID'];
    process.env['FRONTMCP_DEPLOYMENT_MODE'] = 'serverless';

    const { getMachineId } = await import('../machine-id');
    const id = getMachineId();
    // UUID format: 8-4-4-4-12 hex chars
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('should generate different UUIDs across serverless invocations', async () => {
    delete process.env['MACHINE_ID'];
    process.env['FRONTMCP_DEPLOYMENT_MODE'] = 'serverless';

    const mod1 = await import('../machine-id');
    const id1 = mod1.getMachineId();

    jest.resetModules();
    const mod2 = await import('../machine-id');
    const id2 = mod2.getMachineId();

    // Each module load should produce a new ephemeral ID
    expect(id1).not.toBe(id2);
  });

  it('should generate a UUID in standalone mode without file persistence', async () => {
    delete process.env['MACHINE_ID'];
    delete process.env['FRONTMCP_DEPLOYMENT_MODE'];
    // Production mode disables file persistence
    process.env['NODE_ENV'] = 'production';

    const { getMachineId } = await import('../machine-id');
    const id = getMachineId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('should respect setMachineIdOverride', async () => {
    delete process.env['MACHINE_ID'];
    delete process.env['FRONTMCP_DEPLOYMENT_MODE'];

    const { getMachineId, setMachineIdOverride } = await import('../machine-id');
    const original = getMachineId();

    setMachineIdOverride('overridden-id');
    expect(getMachineId()).toBe('overridden-id');

    setMachineIdOverride(undefined);
    expect(getMachineId()).toBe(original);
  });

  it('should prioritize MACHINE_ID over distributed HOSTNAME', async () => {
    process.env['MACHINE_ID'] = 'explicit-wins';
    process.env['FRONTMCP_DEPLOYMENT_MODE'] = 'distributed';
    process.env['HOSTNAME'] = 'pod-name-loses';

    const { getMachineId } = await import('../machine-id');
    expect(getMachineId()).toBe('explicit-wins');
  });
});
