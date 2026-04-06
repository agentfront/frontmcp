import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LogLevel } from '../../common';

// Save original env before each test
const originalEnv: Record<string, string | undefined> = {};
const envKeys = ['FRONTMCP_APP_NAME', 'FRONTMCP_LOG_DIR', 'FRONTMCP_HOME', 'FRONTMCP_LOGS_MAX'];

function saveEnv() {
  for (const k of envKeys) originalEnv[k] = process.env[k];
}
function restoreEnv() {
  for (const k of envKeys) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
}

function makeRecord(overrides?: Partial<{ level: LogLevel; message: string; prefix: string }>) {
  return {
    level: overrides?.level ?? LogLevel.Info,
    levelName: 'INFO',
    message: overrides?.message ?? 'test message',
    args: [],
    timestamp: new Date('2026-04-06T12:34:56.789Z'),
    prefix: overrides?.prefix ?? '',
  };
}

describe('FileLogTransportInstance', () => {
  let tmpDir: string;

  beforeEach(() => {
    saveEnv();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontmcp-file-logger-'));
    process.env['FRONTMCP_LOG_DIR'] = tmpDir;
    process.env['FRONTMCP_APP_NAME'] = 'test-app';
    // Clear module cache so each test gets a fresh instance
    jest.resetModules();
  });

  afterEach(() => {
    restoreEnv();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create a log file in the configured directory', () => {
    const { FileLogTransportInstance } = require('../instances/instance.file-logger');
    new FileLogTransportInstance({});

    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.log'));
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^test-app-.*\.log$/);
  });

  it('should write log records as plain text lines', () => {
    const { FileLogTransportInstance } = require('../instances/instance.file-logger');
    const transport = new FileLogTransportInstance({});

    transport.log(makeRecord({ message: 'hello world' }));
    transport.log(makeRecord({ level: LogLevel.Warn, message: 'a warning', prefix: 'MyScope' }));

    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.log'));
    const content = fs.readFileSync(path.join(tmpDir, files[0]), 'utf-8');
    const lines = content.trim().split('\n');

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('[2026-04-06T12:34:56.789Z] INFO hello world');
    expect(lines[1]).toBe('[2026-04-06T12:34:56.789Z] WARN [MyScope] a warning');
  });

  it('should strip ANSI escape codes from messages', () => {
    const { FileLogTransportInstance } = require('../instances/instance.file-logger');
    const transport = new FileLogTransportInstance({});

    transport.log(makeRecord({ message: '\x1b[31mred text\x1b[0m and \x1b[1mbold\x1b[0m' }));

    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.log'));
    const content = fs.readFileSync(path.join(tmpDir, files[0]), 'utf-8');

    expect(content).not.toContain('\x1b');
    expect(content).toContain('red text and bold');
  });

  it('should use timestamped filename with underscores instead of colons', () => {
    const { FileLogTransportInstance } = require('../instances/instance.file-logger');
    new FileLogTransportInstance({});

    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.log'));
    expect(files[0]).not.toContain(':');
    expect(files[0]).toContain('test-app-');
    // Should have ISO-like timestamp with underscores
    expect(files[0]).toMatch(/test-app-\d{4}-\d{2}-\d{2}T\d{2}_\d{2}_\d{2}/);
  });

  it('should disable file logging when FRONTMCP_LOGS_MAX=0', () => {
    process.env['FRONTMCP_LOGS_MAX'] = '0';
    const { FileLogTransportInstance } = require('../instances/instance.file-logger');
    const transport = new FileLogTransportInstance({});

    transport.log(makeRecord());

    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.log'));
    expect(files).toHaveLength(0);
  });

  it('should rotate old log files when count exceeds max', () => {
    // Create 5 existing log files
    for (let i = 0; i < 5; i++) {
      const ts = `2026-01-0${i + 1}T00_00_00_000Z`;
      fs.writeFileSync(path.join(tmpDir, `test-app-${ts}.log`), `log ${i}\n`);
    }

    process.env['FRONTMCP_LOGS_MAX'] = '3';
    const { FileLogTransportInstance } = require('../instances/instance.file-logger');
    new FileLogTransportInstance({});

    // 5 old + 1 new = 6, max 3 → should keep 3 newest
    const files = fs
      .readdirSync(tmpDir)
      .filter((f) => f.endsWith('.log'))
      .sort();
    expect(files.length).toBe(3);
    // Oldest files should be gone
    expect(files.some((f) => f.includes('2026-01-01'))).toBe(false);
    expect(files.some((f) => f.includes('2026-01-02'))).toBe(false);
    expect(files.some((f) => f.includes('2026-01-03'))).toBe(false);
  });

  it('should fall back to ~/.frontmcp/logs/ when FRONTMCP_LOG_DIR is not set', () => {
    delete process.env['FRONTMCP_LOG_DIR'];
    const customHome = path.join(tmpDir, 'custom-home');
    process.env['FRONTMCP_HOME'] = customHome;

    const { FileLogTransportInstance } = require('../instances/instance.file-logger');
    new FileLogTransportInstance({});

    const logDir = path.join(customHome, 'logs');
    expect(fs.existsSync(logDir)).toBe(true);
    const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.log'));
    expect(files.length).toBe(1);
  });

  it('should default app name to "frontmcp" when FRONTMCP_APP_NAME is not set', () => {
    delete process.env['FRONTMCP_APP_NAME'];
    const { FileLogTransportInstance } = require('../instances/instance.file-logger');
    new FileLogTransportInstance({});

    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.log'));
    expect(files[0]).toMatch(/^frontmcp-/);
  });

  it('should silently degrade if log directory cannot be created', () => {
    // Point to an invalid path (file instead of directory)
    const blockingFile = path.join(tmpDir, 'not-a-dir');
    fs.writeFileSync(blockingFile, 'x');
    process.env['FRONTMCP_LOG_DIR'] = path.join(blockingFile, 'subdir');

    const { FileLogTransportInstance } = require('../instances/instance.file-logger');
    const transport = new FileLogTransportInstance({});

    // Should not throw when logging
    expect(() => transport.log(makeRecord())).not.toThrow();
  });

  it('should not write to file when fd is undefined (degraded mode)', () => {
    process.env['FRONTMCP_LOGS_MAX'] = '0';
    const { FileLogTransportInstance } = require('../instances/instance.file-logger');
    const transport = new FileLogTransportInstance({});

    transport.log(makeRecord());

    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.log'));
    expect(files).toHaveLength(0);
  });

  it('should only rotate files matching the app name prefix', () => {
    // Create files for different app names
    fs.writeFileSync(path.join(tmpDir, 'test-app-2026-01-01T00_00_00_000Z.log'), 'a\n');
    fs.writeFileSync(path.join(tmpDir, 'other-app-2026-01-01T00_00_00_000Z.log'), 'b\n');

    process.env['FRONTMCP_LOGS_MAX'] = '1';
    const { FileLogTransportInstance } = require('../instances/instance.file-logger');
    new FileLogTransportInstance({});

    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.log'));
    // other-app file should still exist (not rotated)
    expect(files.some((f) => f.startsWith('other-app-'))).toBe(true);
    // test-app: 1 old + 1 new = 2, max 1 → old should be removed
    const testAppFiles = files.filter((f) => f.startsWith('test-app-'));
    expect(testAppFiles.length).toBe(1);
  });
});
