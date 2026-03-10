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
});
