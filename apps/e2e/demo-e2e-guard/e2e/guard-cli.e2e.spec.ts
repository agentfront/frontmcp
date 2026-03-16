/**
 * E2E Tests for Guard — CLI/Bin Mode
 *
 * Guards are intentionally disabled in CLI mode (cliMode flag skips
 * guard manager initialization). These tests verify that tools work
 * correctly without guard enforcement — a valuable smoke test for
 * the CLI execution path.
 */
import { ensureBuild, runCli } from './helpers/exec-cli';

describe('Guard CLI E2E', () => {
  beforeAll(async () => {
    await ensureBuild();
  }, 120000);

  it('should execute rate-limited tool via CLI without rate limiting', () => {
    const { stdout, exitCode } = runCli(['rate-limited', '--message', 'hello-cli']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('hello-cli');
  });

  it('should execute timeout tool via CLI without timeout enforcement', () => {
    // In CLI mode, no timeout guard is applied, so a 100ms delay always succeeds
    const { stdout, exitCode } = runCli(['timeout-tool', '--delay-ms', '100']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('done');
  });

  it('should list all guard tools via CLI help', () => {
    const { stdout, exitCode } = runCli(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('rate-limited');
    expect(stdout).toContain('concurrency-mutex');
    expect(stdout).toContain('concurrency-queued');
    expect(stdout).toContain('timeout-tool');
    expect(stdout).toContain('combined-guard');
    expect(stdout).toContain('unguarded');
    expect(stdout).toContain('slow-tool');
  });
});
