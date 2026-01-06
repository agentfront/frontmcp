import {
  FrontMcpLogger,
  LogTransportInterface,
  LogFn,
  LoggingConfigType,
  LogLevel,
  LogLevelName,
  LogRecord,
} from '../../common';
import { ConsoleLogTransportInstance } from './instance.console-logger';

export type GetTransports = () => {
  consoleTransport?: ConsoleLogTransportInstance;
  transports: LogTransportInterface[];
};

export class LoggerInstance extends FrontMcpLogger {
  private readonly level: LogLevel;
  private readonly prefix: string;
  private readonly transports: LogTransportInterface[];
  private readonly consoleTransport?: ConsoleLogTransportInstance;

  constructor(private readonly config: LoggingConfigType, private getTransports: GetTransports) {
    super();
    this.level = config.level;
    this.prefix = config.prefix ?? '';

    const { transports, consoleTransport } = getTransports();
    this.transports = transports;
    this.consoleTransport = consoleTransport;
  }

  child(prefix: string): FrontMcpLogger {
    return new LoggerInstance({ ...this.config, prefix }, this.getTransports);
  }

  /** Internal: fan out to transports if level passes a threshold. */
  private emit(level: LogLevel, message: string, args: unknown[]) {
    if (level < this.level || this.level === LogLevel.Off) return;
    const rec: LogRecord = {
      level,
      levelName: LogLevelName[level],
      message,
      args,
      timestamp: new Date(),
      prefix: this.prefix,
    };
    for (const t of this.transports) {
      try {
        // Fire-and-forget; transports may be async
        void t.log(rec);
      } catch (err) {
        // Never throw from logging
        // Use safe logging to avoid Node.js 24 util.inspect bug with Zod errors

        console.error('[Logger] Transport error:', err instanceof Error ? err.message : 'Unknown error');
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
    if (level < this.level || this.level === LogLevel.Off) return () => void 0;
    if (process.env['NODE_ENV'] === 'development' && this.config.enableConsole && this.consoleTransport) {
      return this.consoleTransport.bind(level, this.prefix);
    }
    const emit = this.emit.bind(this);
    return function (...args: unknown[]) {
      emit(level, String(args[0]), Array.prototype.slice.call(args, 1));
    };
  }
}
