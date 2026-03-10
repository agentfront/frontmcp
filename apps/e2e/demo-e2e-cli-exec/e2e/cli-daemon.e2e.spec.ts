import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureBuild, runCli } from './helpers/exec-cli';

describe('CLI Exec Daemon Commands', () => {
  let homeDir: string;

  beforeAll(async () => {
    await ensureBuild();
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontmcp-daemon-test-'));
  });

  afterAll(() => {
    // Stop daemon if still running
    try {
      runCli(['daemon', 'stop'], { FRONTMCP_HOME: homeDir });
    } catch (_) {
      /* ok */
    }
    // Clean up temp dir
    try {
      fs.rmSync(homeDir, { recursive: true, force: true });
    } catch (_) {
      /* ok */
    }
  });

  it('daemon status before start should show not running', () => {
    const { stdout, exitCode } = runCli(['daemon', 'status'], { FRONTMCP_HOME: homeDir });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Not running');
  });

  it('daemon start should print started message with PID', () => {
    const { stdout, exitCode } = runCli(['daemon', 'start'], { FRONTMCP_HOME: homeDir });
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Daemon (started|already running)/);
    expect(stdout).toMatch(/PID: \d+/);
  });

  it('daemon status after start should show running', () => {
    const { stdout, exitCode } = runCli(['daemon', 'status'], { FRONTMCP_HOME: homeDir });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Running');
    expect(stdout).toMatch(/PID: \d+/);
  });

  it('socket file should exist after start', () => {
    const socketDir = path.join(homeDir, 'sockets');
    const sockets = fs.existsSync(socketDir) ? fs.readdirSync(socketDir) : [];
    expect(sockets.some((f) => f.endsWith('.sock'))).toBe(true);
  });

  it('daemon stop should stop the daemon', () => {
    const { stdout, exitCode } = runCli(['daemon', 'stop'], { FRONTMCP_HOME: homeDir });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Daemon stopped');
  });

  it('daemon status after stop should show not running', () => {
    const { stdout, exitCode } = runCli(['daemon', 'status'], { FRONTMCP_HOME: homeDir });
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Not running/);
  });

  it('socket file should be gone after stop', () => {
    const socketDir = path.join(homeDir, 'sockets');
    const sockets = fs.existsSync(socketDir) ? fs.readdirSync(socketDir).filter((f) => f.endsWith('.sock')) : [];
    expect(sockets.length).toBe(0);
  });
});
