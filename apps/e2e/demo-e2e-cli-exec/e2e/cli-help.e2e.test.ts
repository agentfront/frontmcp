import { ensureBuild, runCli } from './helpers/exec-cli';

describe('CLI Exec Help & Discovery', () => {
  beforeAll(async () => {
    await ensureBuild();
  });

  it('should show help with grouped command categories', () => {
    const { stdout, exitCode } = runCli(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Tools:');
    expect(stdout).toContain('Resources & Prompts:');
    expect(stdout).toContain('System:');
  });

  it('should show version', () => {
    const { stdout, exitCode } = runCli(['--version']);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toContain('1.0.0');
  });

  it('should list tool subcommands in help', () => {
    const { stdout } = runCli(['--help']);
    expect(stdout).toContain('add');
    expect(stdout).toContain('greet');
    expect(stdout).toContain('transform-data');
    expect(stdout).toContain('doctor-tool');
    // Tools named after reserved commands get -tool suffix
    expect(stdout).toContain('job-tool');
    expect(stdout).toContain('subscribe-tool');
    expect(stdout).toContain('skills-tool');
  });

  it('should list resource, template, and prompt commands in help', () => {
    const { stdout } = runCli(['--help']);
    expect(stdout).toContain('resource');
    expect(stdout).toContain('template');
    expect(stdout).toContain('prompt');
  });

  it('should show Skills group in help (fixture has skills)', () => {
    const { stdout } = runCli(['--help']);
    expect(stdout).toContain('Skills:');
    expect(stdout).toContain('skills');
  });

  it('should show Jobs group in help (fixture has jobs)', () => {
    const { stdout } = runCli(['--help']);
    expect(stdout).toContain('Jobs:');
    expect(stdout).toContain('job');
  });

  it('should NOT show Auth group in help (fixture has auth mode public)', () => {
    const { stdout } = runCli(['--help']);
    expect(stdout).not.toContain('Auth:');
    expect(stdout).not.toMatch(/\blogin\b/);
    expect(stdout).not.toMatch(/\blogout\b/);
  });

  it('should NOT show searchSkills or loadSkills in Tools group', () => {
    const { stdout } = runCli(['--help']);
    expect(stdout).not.toContain('search-skills');
    expect(stdout).not.toContain('load-skills');
  });

  it('should NOT show execute-job or get-job-status in Tools group', () => {
    const { stdout } = runCli(['--help']);
    // These system tools should be filtered out of the Tools group
    const toolsSection = stdout.split('Tools:')[1]?.split(/\n\n|\n[A-Z]/)[0] || '';
    expect(toolsSection).not.toContain('execute-job');
    expect(toolsSection).not.toContain('get-job-status');
  });

  it('job run --help should list process-data as a subcommand', () => {
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
