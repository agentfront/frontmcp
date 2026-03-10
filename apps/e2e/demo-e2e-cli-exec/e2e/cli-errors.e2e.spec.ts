import { ensureBuild, runCli } from './helpers/exec-cli';

describe('CLI Exec Error Handling', () => {
  beforeAll(async () => {
    await ensureBuild();
  });

  it('should exit with non-zero code for unknown command', () => {
    const { exitCode } = runCli(['nonexistent-command']);
    expect(exitCode).not.toBe(0);
  });

  it('should exit with non-zero code when missing required tool arg', () => {
    const { exitCode } = runCli(['add']);
    expect(exitCode).not.toBe(0);
  });

  it('should exit with non-zero code for invalid JSON in object param', () => {
    const { exitCode, stderr, stdout } = runCli(['transform-data', '--data', 'not-valid-json']);
    expect(exitCode).not.toBe(0);
    const output = stderr + stdout;
    expect(output).toContain('JSON');
  });

  it('should exit with non-zero code when missing required prompt arg', () => {
    const { exitCode } = runCli(['prompt', 'code-review']);
    expect(exitCode).not.toBe(0);
  });
});
