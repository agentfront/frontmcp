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

  // #382 round-2 — `prompt get explain-calc --op add --a 2 --b 3` was rejected
  // by Commander with "too many arguments for 'get'. Expected 1 argument but
  // got 7." Round 2 registers every prompt arg as a `.option()` on the `get`
  // subcommand so multi-arg prompts work end-to-end.
  describe('prompt get with multiple required args (#382 round-2 reporter repro)', () => {
    it("accepts every declared --<arg> on prompt get (the reporter's exact repro)", () => {
      const { stdout, stderr, exitCode } = runCli([
        'prompt',
        'get',
        'explain-calc',
        '--op',
        'add',
        '--a',
        '2',
        '--b',
        '3',
      ]);
      // Round 1 failed here with: error: too many arguments for 'get'.
      expect(stderr).not.toMatch(/too many arguments/i);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('add');
      expect(stdout).toContain('2');
      expect(stdout).toContain('3');
    });

    it('returns the computed result as the rendered prompt body', () => {
      const { stdout, exitCode } = runCli(['prompt', 'get', 'explain-calc', '--op', 'add', '--a', '2', '--b', '3']);
      expect(exitCode).toBe(0);
      // ExplainCalcPrompt builds: "add 2 and 3 = 5"
      expect(stdout).toMatch(/=\s*5\b/);
    });

    it('exits 2 when any of the multiple required args is missing', () => {
      const { exitCode, stderr } = runCli(['prompt', 'get', 'explain-calc', '--op', 'add', '--a', '2']);
      expect(exitCode).toBe(2);
      expect(stderr).toMatch(/missing required option --b/i);
    });

    it('exits 2 when an unknown option is passed for a known prompt', () => {
      const { exitCode, stderr } = runCli([
        'prompt',
        'get',
        'explain-calc',
        '--op',
        'add',
        '--a',
        '2',
        '--b',
        '3',
        '--bogus',
        'x',
      ]);
      expect(exitCode).toBe(2);
      expect(stderr).toMatch(/unknown option/i);
      expect(stderr).toMatch(/--bogus/);
    });

    it('accepts --key=value form (single-token) in addition to --key value', () => {
      const { stdout, exitCode } = runCli(['prompt', 'get', 'explain-calc', '--op=mul', '--a=4', '--b=5']);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/=\s*20\b/);
    });
  });
});
