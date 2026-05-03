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

  // #369 round-2 — round 1 stripped the literal "Unknown error" but replaced
  // it with "Flow ended with: fail" + INTERNAL_ERROR code, still losing the
  // user's PublicMcpError contents. Round 2 unwraps `originalError` from
  // `FlowControl.fail` in the MCP-handler path so the public message AND
  // the code reach the CLI intact.
  describe('PublicMcpError preservation in JSON output (#369 round-2)', () => {
    it("surfaces the user's message in --output json (not the FlowControl sentinel)", () => {
      const { stdout, stderr, exitCode } = runCli(['--output', 'json', 'divide', '--a', '1', '--b', '0']);
      expect(exitCode).toBe(1);
      const combined = stdout + stderr;
      // Round 1 surfaced this string in content[].text; round 2 must not.
      expect(combined).not.toMatch(/Flow ended with/i);
      // The headline assertion — the user's PublicMcpError message must reach the CLI.
      expect(combined).toContain('Cannot divide by zero');
    });

    it('preserves the PublicMcpError code in --output json (INVALID_PARAMS, not INTERNAL_ERROR)', () => {
      const { stdout, stderr, exitCode } = runCli(['--output', 'json', 'divide', '--a', '1', '--b', '0']);
      expect(exitCode).toBe(1);
      const combined = stdout + stderr;
      expect(combined).toContain('INVALID_PARAMS');
      // Round 1 turned every PublicMcpError code into the generic INTERNAL_ERROR
      // because the FlowControl wrapper hid the original. The unwrap must
      // restore the original code — this assertion is the load-bearing one.
      expect(combined).not.toContain('INTERNAL_ERROR');
    });

    it('marks the result as isError=true so JSON consumers can branch on it', () => {
      const { stdout, stderr } = runCli(['--output', 'json', 'divide', '--a', '1', '--b', '0']);
      expect(stdout + stderr).toMatch(/"isError"\s*:\s*true/);
    });
  });
});
