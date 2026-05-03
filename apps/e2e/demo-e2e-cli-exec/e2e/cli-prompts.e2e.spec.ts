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

  // #382 — `prompt get <name>` mirrors `resource read <uri>` symmetry.
  describe('prompt get <name> (#382)', () => {
    it('renders a prompt via the symmetric `prompt get` subcommand', () => {
      const { stdout, exitCode } = runCli(['prompt', 'get', 'code-review', '--language', 'typescript']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('typescript');
    });

    it('exits 1 when the named prompt does not exist', () => {
      const { stderr, exitCode } = runCli(['prompt', 'get', 'nonexistent']);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/Unknown prompt|not found/i);
    });

    it('exits 2 when a required option is missing', () => {
      const { exitCode } = runCli(['prompt', 'get', 'code-review']);
      expect(exitCode).toBe(2);
    });
  });
});
