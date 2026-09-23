import { ensureBuild, runCli } from './helpers/exec-cli';

describe('CLI Exec Resource Commands', () => {
  beforeAll(async () => {
    await ensureBuild();
  });

  it('should list resources', () => {
    const { stdout, exitCode } = runCli(['resource', 'list']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('app://info');
  });

  it('should read a static resource by URI', () => {
    const { stdout, exitCode } = runCli(['resource', 'read', 'app://info']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('CLI Exec E2E');
  });

  it('should list resource templates', () => {
    const { stdout, exitCode } = runCli(['template', 'list']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('items://item/{itemId}');
  });

  it('should read a resource template with parameters', () => {
    const { stdout, exitCode } = runCli(['template', 'item-by-id', '--item-id', 'abc-123']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('abc-123');
  });

  it('should keep "/" in a reserved-expansion parameter, so nested skill paths resolve', () => {
    const { stdout, stderr, exitCode } = runCli(['template', 'sep2640-skill-md', '--skill-path', 'demo/math-helper']);
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('## Math Helper');
  });

  it('should still accept the legacy --+skill-path flag, hidden from help', () => {
    const legacy = runCli(['template', 'sep2640-skill-md', '--+skill-path', 'demo/math-helper']);
    expect(legacy.exitCode).toBe(0);
    expect(legacy.stdout).toContain('## Math Helper');

    const help = runCli(['template', 'sep2640-skill-md', '--help']);
    expect(help.stdout).toContain('--skill-path <value>');
    expect(help.stdout).not.toContain('--+');
  });
});
