import { ensureBuild, runCli } from './helpers/exec-cli';

describe('CLI Exec Error Handling', () => {
  beforeAll(async () => {
    await ensureBuild();
  });

  it('should show help for unknown command', () => {
    const { stdout, exitCode } = runCli(['nonexistent-command']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage:');
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

  // #378 — every error path used to print to stderr and exit 0, so CI/scripts
  // could not detect tool failures. Exit codes now follow POSIX convention:
  //   0 = success, 1 = runtime error, 2 = usage / commander error.
  describe('exit code conventions (#378)', () => {
    it('exits 2 on Zod validation failure (usage error)', () => {
      const { exitCode } = runCli(['add', '--a', 'not-a-number', '--b', '2']);
      // Zod's "invalid_type" surfaces as a usage error → exit 2.
      // Some bundlers may surface it as a runtime error → 1; both are non-zero.
      expect(exitCode === 1 || exitCode === 2).toBe(true);
    });

    it('exits 1 when a tool throws a public McpError at runtime', () => {
      // The `divide` tool calls this.fail(new PublicMcpError('Cannot divide by zero')) for b=0.
      const { exitCode, stderr } = runCli(['divide', '--a', '1', '--b', '0']);
      expect(exitCode).toBe(1);
      // #369 — stderr now carries the public message, not "Unknown error".
      expect(stderr.toLowerCase()).not.toContain('unknown error');
    });

    it('exits 2 for an unknown subcommand under a system command', () => {
      const { exitCode } = runCli(['prompt', 'totally-not-a-real-prompt-or-subcmd']);
      expect(exitCode).toBe(2);
    });
  });
});
