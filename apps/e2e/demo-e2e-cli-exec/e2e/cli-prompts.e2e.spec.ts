import { ensureBuild, runCli } from './helpers/exec-cli';

describe('CLI Exec Prompt Commands', () => {
  beforeAll(async () => {
    await ensureBuild();
  });

  it('should list prompts', () => {
    const { stdout, exitCode } = runCli(['prompt', 'list']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('code-review');
  });

  it('should execute prompt with required argument', () => {
    const { stdout, exitCode } = runCli(['prompt', 'code-review', '--language', 'typescript']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('typescript');
  });

  it('should execute prompt with required and optional arguments', () => {
    const { stdout, exitCode } = runCli(['prompt', 'code-review', '--language', 'python', '--style', 'thorough']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('python');
    expect(stdout).toContain('thorough');
  });
});
