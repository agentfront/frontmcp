import { LogTransportInterface, LogRecord, LogTransport, LogLevel } from '../../common';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const LOG_LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.Off]: 'OFF',
  [LogLevel.Debug]: 'DEBUG',
  [LogLevel.Verbose]: 'VERBOSE',
  [LogLevel.Info]: 'INFO',
  [LogLevel.Warn]: 'WARN',
  [LogLevel.Error]: 'ERROR',
};

/** Strip ANSI escape codes from a string (colors, bold, etc.). */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Maximum number of log files to keep per app (npm-style count-based rotation). */
const DEFAULT_LOGS_MAX = 25;

/**
 * File-based log transport for CLI mode.
 *
 * Follows the npm/pip pattern: always captures full verbosity to file
 * regardless of the console log level, so users can inspect server
 * activity after the fact without console noise.
 *
 * **Log location:** `~/.frontmcp/logs/{appName}-{ISO-timestamp}.log`
 * (configurable via `FRONTMCP_LOG_DIR` or `FRONTMCP_HOME`).
 *
 * **Format:** Plain text, no ANSI colors, one record per line:
 * ```
 * [2026-04-06T12:34:56.789Z] INFO [FrontMcp.MultiAppScope] Scope ready — 3 apps
 * ```
 *
 * **Rotation:** Count-based — keeps the most recent 25 log files
 * (configurable via `FRONTMCP_LOGS_MAX`; set to 0 to disable file logging).
 */
@LogTransport({
  name: 'FileLogger',
  description: 'Writes logs to a file for CLI mode diagnostics',
})
export class FileLogTransportInstance extends LogTransportInterface {
  private fd: number | undefined;
  private readonly logDir: string;
  private readonly appName: string;

  constructor(_config: unknown, ..._args: unknown[]) {
    super();
    this.appName = process.env['FRONTMCP_APP_NAME'] || 'frontmcp';
    this.logDir =
      process.env['FRONTMCP_LOG_DIR'] ||
      path.join(process.env['FRONTMCP_HOME'] || path.join(os.homedir(), '.frontmcp'), 'logs');

    const logsMax = parseInt(process.env['FRONTMCP_LOGS_MAX'] || '', 10);
    if (logsMax === 0) {
      // File logging explicitly disabled
      this.fd = undefined;
      return;
    }

    try {
      fs.mkdirSync(this.logDir, { recursive: true });

      // npm-style timestamped filename: appName-2026-04-06T12_34_56_789Z.log
      const ts = new Date().toISOString().replace(/:/g, '_');
      const filePath = path.join(this.logDir, `${this.appName}-${ts}.log`);
      this.fd = fs.openSync(filePath, 'a');

      // Rotate old log files
      this.rotate(isNaN(logsMax) ? DEFAULT_LOGS_MAX : logsMax);
    } catch {
      // If we can't open the log file, degrade silently
      this.fd = undefined;
    }
  }

  log(rec: LogRecord): void {
    if (this.fd === undefined) return;

    const ts = rec.timestamp.toISOString();
    const level = LOG_LEVEL_LABELS[rec.level] ?? 'INFO';
    const prefix = rec.prefix ? ` [${rec.prefix}]` : '';
    const message = stripAnsi(String(rec.message));
    const line = `[${ts}] ${level}${prefix} ${message}\n`;

    try {
      fs.writeSync(this.fd, line);
    } catch {
      // Silently ignore write errors (disk full, file removed, etc.)
    }
  }

  /** Remove oldest log files when count exceeds max (npm-style rotation). */
  private rotate(maxFiles: number): void {
    try {
      const prefix = `${this.appName}-`;
      const files = fs
        .readdirSync(this.logDir)
        .filter((f) => f.startsWith(prefix) && f.endsWith('.log'))
        .sort(); // ISO timestamps sort chronologically

      const excess = files.length - maxFiles;
      if (excess <= 0) return;

      for (let i = 0; i < excess; i++) {
        try {
          fs.unlinkSync(path.join(this.logDir, files[i]));
        } catch {
          // Ignore individual file deletion failures
        }
      }
    } catch {
      // Ignore rotation failures
    }
  }
}
