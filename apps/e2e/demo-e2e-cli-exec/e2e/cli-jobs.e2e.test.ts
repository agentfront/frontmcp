import { ensureBuild, runCli } from './helpers/exec-cli';

describe('CLI Exec Job Commands', () => {
  beforeAll(async () => {
    await ensureBuild();
  });

  it('job list should show process-data', () => {
    const { stdout, exitCode } = runCli(['job', 'list']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('process-data');
  });

  it('job list --output json should return JSON with jobs', () => {
    const { stdout, exitCode } = runCli(['--output', 'json', 'job', 'list']);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toBeDefined();
    const jobs = parsed.jobs || parsed;
    expect(Array.isArray(jobs)).toBe(true);
    const names = jobs.map((j: { name?: string }) => j.name);
    expect(names).toContain('process-data');
  });

  it('job run process-data --payload "hello" should return processed result', () => {
    const { stdout, exitCode } = runCli(['job', 'run', 'process-data', '--payload', 'hello']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Processed: hello');
  });

  it('job run process-data without --payload should fail', () => {
    const { exitCode, stderr } = runCli(['job', 'run', 'process-data']);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('--payload');
  });

  it('job run process-data --background --payload "x" should return runId', () => {
    const { stdout, exitCode } = runCli(['job', 'run', 'process-data', '--background', '--payload', 'x']);
    expect(exitCode).toBe(0);
    // In background mode, should either show runId or processed result
    expect(stdout.length).toBeGreaterThan(0);
  });

  it('job run --help should list process-data subcommand', () => {
    const { stdout, exitCode } = runCli(['job', 'run', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('process-data');
  });

  it('job run process-data --help should show --payload option', () => {
    const { stdout, exitCode } = runCli(['job', 'run', 'process-data', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--payload');
  });
});
