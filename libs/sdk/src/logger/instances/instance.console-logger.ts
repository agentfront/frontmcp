import { escapeControlCharacters, supportsAnsi } from '@frontmcp/utils';

import { LogLevel, LogTransport, LogTransportInterface, type LogFn, type LogRecord } from '../../common';

type LogLevelMeta = {
  label: string;
  ansi: string; // ANSI for TTY (kept for completeness)
};

/** What every line of a console record after the first starts with, so it cannot pass for the start of a record. */
const CONTINUATION_INDENT = '  ';

/**
 * Text as a console record prints it: its line breaks kept, every line after the first indented, and every other
 * control character as a visible escape, so it can neither start what looks like another record nor rewrite the terminal.
 */
function formatConsoleText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => escapeControlCharacters(line))
    .join(`\n${CONTINUATION_INDENT}`);
}

/** A logged value as the console prints it: a string formatted like the message, anything else left to the console. */
function formatConsoleArgument(value: unknown): unknown {
  return typeof value === 'string' ? formatConsoleText(value) : value;
}

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
    [LogLevel.Verbose]: { label: 'VERBOSE', ansi: '\x1b[90m' }, // blue
    [LogLevel.Info]: { label: 'INFO', ansi: '\x1b[32m' }, // green
    [LogLevel.Warn]: { label: 'WARN', ansi: '\x1b[33m' }, // yellow
    [LogLevel.Error]: { label: 'ERROR', ansi: '\x1b[31m' }, // red
  };

  /** Returns a console function with the prefix (ANSI only) that prints string values as `formatConsoleText` does */
  bind(level: LogLevel, loggerPrefix?: string): LogFn {
    const method = this.pickMethod(level);
    const meta = this.levelTags[level] ?? this.levelTags[LogLevel.Info];
    const ts = this.friendlyTime(new Date());

    const RESET = '\x1b[0m';
    const BOLD = '\x1b[1m';
    const DIM = '\x1b[2m';
    const GRAY = '\x1b[90m';

    const useAnsi = supportsAnsi();
    const timePart = useAnsi ? `${DIM}[${ts}]${RESET}` : `[${ts}]`;
    // The name goes into the format string: a `%` in it must print as is, not take the place of a value
    const prefixText = loggerPrefix ? escapeControlCharacters(loggerPrefix).replace(/%/g, '%%') : undefined;
    const scopePart = prefixText ? (useAnsi ? `${BOLD}[${prefixText}]${RESET}` : `[${prefixText}]`) : undefined;
    const levelPart = useAnsi ? `${BOLD}${meta.ansi}${meta.label}${RESET}` : meta.label;

    const fmt = [timePart, scopePart, levelPart, '%s'].filter(Boolean).join(' ');
    const write = method.bind(console, fmt);
    return (...values: unknown[]) => write(...values.map(formatConsoleArgument));
  }

  private pickMethod(level: LogLevel): LogFn {
    switch (level) {
      case LogLevel.Debug:
        return console.debug.bind(console);
      case LogLevel.Verbose:
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

  private friendlyTime(d: Date): string {
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  }
}
