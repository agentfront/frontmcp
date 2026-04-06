/**
 * E2E tests for CLI logging behavior.
 *
 * Verifies:
 * - Console output is clean (no server logs) by default
 * - --verbose flag enables console logging
 * - Log files are written to the configured directory
 * - --log-dir flag overrides the log directory
 * - Log files contain no ANSI escape codes
 * - Skill content files (file-based instructions) are copied to dist
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ensureBuild, runCli, getDistDir } from './helpers/exec-cli';

describe('CLI Logging', () => {
  let tmpLogDir: string;

  beforeAll(async () => {
    await ensureBuild();
  });

  beforeEach(() => {
    tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontmcp-cli-log-e2e-'));
  });

  afterEach(() => {
    fs.rmSync(tmpLogDir, { recursive: true, force: true });
  });

  // ─── Silent console by default ─────────────────────────────────────────────

  describe('console output (default)', () => {
    it('should not print server initialization logs to stdout', () => {
      const { stdout, exitCode } = runCli(['add', '--a', '1', '--b', '2']);
      expect(exitCode).toBe(0);
      // These server logs should NOT appear in console
      expect(stdout).not.toContain('Initializing FrontMCP');
      expect(stdout).not.toContain('[FrontMcp.MultiAppScope]');
      expect(stdout).not.toContain('INFO');
      expect(stdout).not.toContain('WARN');
    });

    it('should not print server logs for skills list command', () => {
      const { stdout, stderr, exitCode } = runCli(['skills', 'list']);
      const output = stdout + stderr;
      expect(exitCode).toBe(0);
      expect(output).not.toContain('Initializing FrontMCP');
      expect(output).not.toContain('[FrontMcp.MultiAppScope]');
    });
  });

  // ─── --verbose flag ────────────────────────────────────────────────────────

  describe('--verbose flag', () => {
    it('should run successfully with --verbose flag', () => {
      const { stdout, exitCode } = runCli(['--verbose', 'add', '--a', '1', '--b', '2']);
      expect(exitCode).toBe(0);
      // Tool output should still appear
      expect(stdout).toContain('3');
    });

    it('should write to log file even with --verbose', () => {
      runCli(['--verbose', '--log-dir', tmpLogDir, 'add', '--a', '1', '--b', '2']);
      const logFiles = fs.readdirSync(tmpLogDir).filter((f) => f.endsWith('.log'));
      expect(logFiles.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── File logging ──────────────────────────────────────────────────────────

  describe('file logging', () => {
    it('should write log files to the specified --log-dir', () => {
      const { exitCode } = runCli(['--log-dir', tmpLogDir, 'add', '--a', '1', '--b', '2']);
      expect(exitCode).toBe(0);

      const logFiles = fs.readdirSync(tmpLogDir).filter((f) => f.endsWith('.log'));
      expect(logFiles.length).toBeGreaterThanOrEqual(1);
    });

    it('should write log files via FRONTMCP_LOG_DIR env var', () => {
      const { exitCode } = runCli(['add', '--a', '1', '--b', '2'], { FRONTMCP_LOG_DIR: tmpLogDir });
      expect(exitCode).toBe(0);

      const logFiles = fs.readdirSync(tmpLogDir).filter((f) => f.endsWith('.log'));
      expect(logFiles.length).toBeGreaterThanOrEqual(1);
    });

    it('should use app name in log filename', () => {
      const { exitCode } = runCli(['add', '--a', '1', '--b', '2'], { FRONTMCP_LOG_DIR: tmpLogDir });
      expect(exitCode).toBe(0);

      const logFiles = fs.readdirSync(tmpLogDir).filter((f) => f.endsWith('.log'));
      expect(logFiles[0]).toMatch(/^cli-exec-demo-/);
    });

    it('should not contain ANSI escape codes in log files', () => {
      runCli(['add', '--a', '1', '--b', '2'], { FRONTMCP_LOG_DIR: tmpLogDir });

      const logFiles = fs.readdirSync(tmpLogDir).filter((f) => f.endsWith('.log'));
      if (logFiles.length > 0) {
        const content = fs.readFileSync(path.join(tmpLogDir, logFiles[0]), 'utf-8');
        // eslint-disable-next-line no-control-regex
        expect(content).not.toMatch(/\x1b\[/);
      }
    });

    it('should contain server log messages in log file', () => {
      runCli(['add', '--a', '1', '--b', '2'], { FRONTMCP_LOG_DIR: tmpLogDir });

      const logFiles = fs.readdirSync(tmpLogDir).filter((f) => f.endsWith('.log'));
      expect(logFiles.length).toBeGreaterThanOrEqual(1);

      const content = fs.readFileSync(path.join(tmpLogDir, logFiles[0]), 'utf-8');
      // Fixture uses LogLevel.Warn, so file should contain WARN-level messages
      expect(content).toContain('WARN');
      // Verify ISO timestamp format
      expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T/);
    });

    it('should disable file logging when FRONTMCP_LOGS_MAX=0', () => {
      runCli(['add', '--a', '1', '--b', '2'], { FRONTMCP_LOG_DIR: tmpLogDir, FRONTMCP_LOGS_MAX: '0' });

      const logFiles = fs.readdirSync(tmpLogDir).filter((f) => f.endsWith('.log'));
      expect(logFiles).toHaveLength(0);
    });
  });
});

describe('CLI Skill Asset Copying', () => {
  beforeAll(async () => {
    await ensureBuild();
  });

  it('should copy file-based skill instruction .md files to dist', () => {
    const distDir = getDistDir();
    const docsDir = path.join(distDir, 'docs');
    // The greeting-helper skill has instructions: { file: './docs/greeting-guide.md' }
    // Build should have copied it to dist/docs/greeting-guide.md
    expect(fs.existsSync(docsDir)).toBe(true);
    const mdFile = path.join(docsDir, 'greeting-guide.md');
    expect(fs.existsSync(mdFile)).toBe(true);

    const content = fs.readFileSync(mdFile, 'utf-8');
    expect(content).toContain('Greeting Guide');
  });

  it('should list file-based skills via skills list command', () => {
    const { stdout, exitCode } = runCli(['skills', 'list', '--output', 'json']);
    expect(exitCode).toBe(0);

    const result = JSON.parse(stdout);
    const skills = result.skills || result || [];
    const greetingSkill = skills.find((s: { name?: string; id?: string }) => (s.name || s.id) === 'greeting-helper');
    expect(greetingSkill).toBeDefined();
  });
});
