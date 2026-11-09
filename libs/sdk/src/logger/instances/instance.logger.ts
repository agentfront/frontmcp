import { isDevelopment } from '@frontmcp/utils';

import {
  FrontMcpLogger,
  LogLevel,
  LogLevelName,
  type LogFn,
  type LoggingConfigType,
  type LogRecord,
  type LogTransportInterface,
} from '../../common';
import { type ConsoleLogTransportInstance } from './instance.console-logger';

const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  [LogLevel.Verbose]: 0,
  [LogLevel.Debug]: 1,
  [LogLevel.Info]: 2,
  [LogLevel.Warn]: 3,
  [LogLevel.Error]: 4,
  [LogLevel.Off]: Number.POSITIVE_INFINITY,
};

const failedTransports = new WeakSet<LogTransportInterface>();

function reportTransportFailure(transport: LogTransportInterface, error: unknown): void {
  if (failedTransports.has(transport)) return;
  failedTransports.add(transport);
  // Only the message: Node.js 24's util.inspect can throw on Zod errors.
  console.error(
    `[Logger] Log transport ${transport.constructor.name} failed, and its later failures are not reported:`,
    error instanceof Error ? error.message : String(error),
  );
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as PromiseLike<unknown> | undefined)?.then === 'function';
}

export type GetTransports = () => {
  consoleTransport?: ConsoleLogTransportInstance;
  transports: LogTransportInterface[];
};

export class LoggerInstance extends FrontMcpLogger {
  private readonly level: LogLevel;
  private readonly prefix: string;
  private readonly transports: LogTransportInterface[];
  private readonly consoleTransport?: ConsoleLogTransportInstance;

  /**
   * @param config - Logging options; `config.prefix` (`logging.prefix`) tags every logger's records
   * @param getTransports - The transports records fan out to
   * @param scopePrefix - What a child logger is named (`logger.child(name)`), after `logging.prefix`
   */
  constructor(
    private readonly config: LoggingConfigType,
    private getTransports: GetTransports,
    scopePrefix?: string,
  ) {
    super();
    this.level = config.level;
    this.prefix = [config.prefix, scopePrefix].filter(Boolean).join(':');

    const { transports, consoleTransport } = getTransports();
    this.transports = transports;
    this.consoleTransport = consoleTransport;
  }

  child(prefix: string): FrontMcpLogger {
    return new LoggerInstance(this.config, this.getTransports, prefix);
  }

  private isEnabled(level: LogLevel): boolean {
    if (this.level === LogLevel.Off) return false;
    return (LOG_LEVEL_SEVERITY[level] ?? level) >= (LOG_LEVEL_SEVERITY[this.level] ?? this.level);
  }

  /** Internal: fan out to transports if level passes a threshold. */
  private emit(level: LogLevel, message: string, args: unknown[]) {
    if (!this.isEnabled(level)) return;
    const rec: LogRecord = {
      level,
      levelName: LogLevelName[level],
      message,
      args,
      timestamp: new Date(),
      prefix: this.prefix,
    };
    for (const transport of this.transports) {
      try {
        const pending = transport.log(rec);
        if (isPromiseLike(pending)) pending.then(undefined, (error) => reportTransportFailure(transport, error));
      } catch (error) {
        reportTransportFailure(transport, error);
      }
    }
  }

  get verbose(): LogFn {
    return this._getter(LogLevel.Verbose);
  }

  get debug(): LogFn {
    return this._getter(LogLevel.Debug);
  }

  get info(): LogFn {
    return this._getter(LogLevel.Info);
  }

  get warn(): LogFn {
    return this._getter(LogLevel.Warn);
  }

  get error(): LogFn {
    return this._getter(LogLevel.Error);
  }

  private _getter(level: LogLevel): LogFn {
    if (!this.isEnabled(level)) return () => void 0;
    // Dev shortcut: bind console directly for fast dev output.
    // Only when console is the SOLE transport. When observability adds
    // StructuredLogTransport, transports.length > 1 so we fall through
    // to emit() which fans out to ALL transports (including console).
    if (
      isDevelopment() &&
      this.config.enableConsole &&
      this.consoleTransport &&
      this.transports.length === 1 &&
      this.transports[0] === this.consoleTransport
    ) {
      return this.consoleTransport.bind(level, this.prefix);
    }
    const emit = this.emit.bind(this);
    return function (...args: unknown[]) {
      emit(level, String(args[0]), Array.prototype.slice.call(args, 1));
    };
  }
}
