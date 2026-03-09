import { ensureBuild, spawnCli } from './helpers/exec-cli';

describe('CLI Exec Subscribe Commands', () => {
  beforeAll(async () => {
    await ensureBuild();
  });

  it('subscribe resource "app://info" should start without crash', async () => {
    const { stdout, stderr, exitCode } = await spawnCli(['subscribe', 'resource', 'app://info'], 3000);
    // Should have printed subscription message before SIGINT
    expect(stdout).toContain('Subscribed');
    // Exit code 0 from SIGINT handler or null (killed) is acceptable
    expect(exitCode).toBeLessThanOrEqual(1);
    // Should not have a TypeError or crash
    expect(stderr).not.toContain('TypeError');
    expect(stderr).not.toContain('is not a function');
  });

  it('subscribe notification "*" should start without crash', async () => {
    const { stdout, stderr, exitCode } = await spawnCli(['subscribe', 'notification', '*'], 3000);
    expect(stdout).toContain('Listening');
    expect(exitCode).toBeLessThanOrEqual(1);
    expect(stderr).not.toContain('TypeError');
    expect(stderr).not.toContain('is not a function');
  });

  it('subscribe notification "test" should start without crash', async () => {
    const { stdout, stderr, exitCode } = await spawnCli(['subscribe', 'notification', 'test'], 3000);
    expect(stdout).toContain('Listening');
    expect(exitCode).toBeLessThanOrEqual(1);
    expect(stderr).not.toContain('TypeError');
    expect(stderr).not.toContain('is not a function');
  });
});
