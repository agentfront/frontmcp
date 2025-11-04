import {
  LogTransportInterface,
  LogRecord,
  LogTransport,
  LogLevel,
  LogFn,
} from '@frontmcp/sdk';

type LogLevelMeta = {
  label: string;
  ansi: string; // ANSI for TTY (kept for completeness)
};

@LogTransport({
  name: 'ConsoleLogger',
  description: 'Used as default console logger',
})
export class ConsoleLogTransportInstance extends LogTransportInterface {

  log(rec: LogRecord): void {
    const fn = this.bind(rec.level, rec.prefix);
    fn(String(rec.message), ...rec.args);
  }

  private levelTags: Record<LogLevel, LogLevelMeta> = {
    [LogLevel.Off]: { label: '', ansi: '' },
    [LogLevel.Debug]: { label: 'DEBUG', ansi: '\x1b[34m' }, // gray
    [LogLevel.VERBOSE]: { label: 'VERBOSE', ansi: '\x1b[90m' }, // blue
    [LogLevel.Info]: { label: 'INFO', ansi: '\x1b[32m' }, // green
    [LogLevel.Warn]: { label: 'WARN', ansi: '\x1b[33m' }, // yellow
    [LogLevel.Error]: { label: 'ERROR', ansi: '\x1b[31m' }, // red
  };

  /** Returns a *bound native console function* with the prefix (ANSI only) */
  bind(level: LogLevel, loggerPrefix?: string): LogFn {
    const method = this.pickMethod(level);
    const meta = this.levelTags[level] ?? this.levelTags[LogLevel.Info];
    const ts = this.friendlyTime(new Date());

    const RESET = '\x1b[0m';
    const BOLD = '\x1b[1m';
    const DIM = '\x1b[2m';
    const GRAY = '\x1b[90m';

    const useAnsi = this.supportsAnsi();
    const timePart = useAnsi ? `${DIM}[${ts}]${RESET}` : `[${ts}]`;
    const scopePart = loggerPrefix
      ? (useAnsi ? `${BOLD}[${loggerPrefix}]${RESET}` : `[${loggerPrefix}]`)
      : undefined;
    const levelPart = useAnsi ? `${BOLD}${meta.ansi}${meta.label}${RESET}` : meta.label;

    const fmt = [timePart, scopePart, levelPart, '%s'].filter(Boolean).join(' ');
    return method.bind(console, fmt);
  }

  private pickMethod(level: LogLevel): LogFn {
    switch (level) {
      case LogLevel.Debug:
        return console.debug.bind(console);
      case LogLevel.VERBOSE:
        return console.info.bind(console);
      case LogLevel.Info:
        return console.info.bind(console);
      case LogLevel.Warn:
        return console.warn.bind(console);
      case LogLevel.Error:
        return console.error.bind(console);
      default:
        return console.log.bind(console);
    }
  }

  private supportsAnsi(): boolean {
    if (typeof process === 'undefined') return false;
    const env = process.env || {};
    if (env['NO_COLOR']) return false;
    if (env['FORCE_COLOR']) return true;
    return !!(process.stdout && (process.stdout as any).isTTY);
  }

  private friendlyTime(d: Date): string {
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  }

}