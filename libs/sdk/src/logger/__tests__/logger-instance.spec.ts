import { LogLevel, type LogRecord, type LogTransportInterface } from '../../common';
import { LoggerInstance } from '../instances/instance.logger';

function loggerAt(level: LogLevel, transports: LogTransportInterface[]) {
  return new LoggerInstance({ level, enableConsole: false } as never, () => ({ transports }));
}

function recordingTransport() {
  const records: LogRecord[] = [];
  const transport = { log: (rec: LogRecord) => void records.push(rec) } as LogTransportInterface;
  return { transport, records };
}

function logEveryLevel(logger: LoggerInstance) {
  logger.verbose('verbose line');
  logger.debug('debug line');
  logger.info('info line');
  logger.warn('warn line');
  logger.error('error line');
}

describe('log level order (#1174)', () => {
  it.each([
    [LogLevel.Verbose, ['verbose', 'debug', 'info', 'warn', 'error']],
    [LogLevel.Debug, ['debug', 'info', 'warn', 'error']],
    [LogLevel.Info, ['info', 'warn', 'error']],
    [LogLevel.Warn, ['warn', 'error']],
    [LogLevel.Error, ['error']],
    [LogLevel.Off, []],
  ])('a logger at level %s logs %j', (level, expectedLevels) => {
    const { transport, records } = recordingTransport();

    logEveryLevel(loggerAt(level, [transport]));

    expect(records.map((rec) => rec.levelName)).toEqual(expectedLevels);
  });

  it('keeps the numeric values a config may pass', () => {
    expect([LogLevel.Debug, LogLevel.Verbose, LogLevel.Info, LogLevel.Warn, LogLevel.Error]).toEqual([0, 1, 2, 3, 4]);

    const { transport, records } = recordingTransport();
    logEveryLevel(loggerAt(1 as LogLevel, [transport]));

    expect(records.map((rec) => rec.levelName)).toContain('debug');
  });
});

describe('a failing log transport (#1158)', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

  class RejectingSink implements LogTransportInterface {
    async log(): Promise<void> {
      throw new Error('sink is down');
    }
  }

  class ThrowingSink implements LogTransportInterface {
    log(): void {
      throw new Error('disk is full');
    }
  }

  it('handles an async rejection, reports it once and keeps logging to the other transports', async () => {
    const { transport, records } = recordingTransport();
    const logger = loggerAt(LogLevel.Info, [new RejectingSink(), transport]);

    logger.info('first');
    logger.child('Child').warn('second');
    await settle();

    expect(records.map((rec) => rec.message)).toEqual(['first', 'second']);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('RejectingSink'), 'sink is down');
  });

  it('reports a synchronous throw once per transport', async () => {
    const logger = loggerAt(LogLevel.Info, [new ThrowingSink(), new RejectingSink()]);

    logger.info('first');
    logger.info('second');
    await settle();

    expect(consoleError).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('ThrowingSink'), 'disk is full');
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('RejectingSink'), 'sink is down');
  });
});
