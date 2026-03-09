import { ensureBuild, runCli } from './helpers/exec-cli';

describe('CLI Exec Output Modes', () => {
  beforeAll(async () => {
    await ensureBuild();
  });

  it('should output plain text by default for tool', () => {
    const { stdout, exitCode } = runCli(['add', '--a', '1', '--b', '2']);
    expect(exitCode).toBe(0);
    // Text mode should not produce the JSON mode wrapper with 'content' array
    const trimmed = stdout.trim();
    expect(trimmed).toContain('3');
    // Should NOT have the JSON mode wrapper
    try {
      const parsed = JSON.parse(trimmed);
      expect(parsed.content).toBeUndefined();
    } catch {
      // If not parseable as JSON, that's fine for text mode
    }
  });

  it('should output valid JSON in json mode for tool', () => {
    const { stdout, exitCode } = runCli(['--output', 'json', 'add', '--a', '1', '--b', '2']);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toBeDefined();
    expect(parsed.content).toBeDefined();
    expect(Array.isArray(parsed.content)).toBe(true);
  });

  it('should output valid JSON for resource list in json mode', () => {
    const { stdout, exitCode } = runCli(['--output', 'json', 'resource', 'list']);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toBeDefined();
    expect(parsed.resources).toBeDefined();
  });

  it('should output valid JSON for prompt in json mode', () => {
    const { stdout, exitCode } = runCli(['--output', 'json', 'prompt', 'code-review', '--language', 'go']);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toBeDefined();
    expect(parsed.messages).toBeDefined();
  });
});
