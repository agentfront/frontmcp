import { StdoutSink } from '../logging/sinks/stdout.sink';
import { ConsoleSink } from '../logging/sinks/console.sink';
import { WinstonSink } from '../logging/sinks/winston.sink';
import { PinoSink } from '../logging/sinks/pino.sink';
import { CallbackSink } from '../logging/sinks/callback.sink';
import type { StructuredLogEntry } from '../logging/structured-log.types';

function makeEntry(overrides?: Partial<StructuredLogEntry>): StructuredLogEntry {
  return {
    timestamp: '2026-03-31T14:00:00.000Z',
    level: 'info',
    severity_number: 9,
    message: 'test message',
    ...overrides,
  };
}

describe('StdoutSink', () => {
  it('should write NDJSON to the stream', () => {
    const chunks: string[] = [];
    const stream = {
      write: (data: string) => {
        chunks.push(data);
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    const sink = new StdoutSink({ stream });
    const entry = makeEntry();
    sink.write(entry);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(JSON.stringify(entry) + '\n');
  });

  it('should pretty-print when enabled', () => {
    const chunks: string[] = [];
    const stream = {
      write: (data: string) => {
        chunks.push(data);
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    const sink = new StdoutSink({ stream, pretty: true });
    const entry = makeEntry();
    sink.write(entry);

    expect(chunks[0]).toBe(JSON.stringify(entry, null, 2) + '\n');
  });

  it('should default to process.stdout', () => {
    const spy = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    const sink = new StdoutSink();
    sink.write(makeEntry());
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('ConsoleSink', () => {
  it('should use console.info for info level', () => {
    const spy = jest.spyOn(console, 'info').mockImplementation();
    const sink = new ConsoleSink();
    const entry = makeEntry({ level: 'info' });
    sink.write(entry);
    expect(spy).toHaveBeenCalledWith(entry);
    spy.mockRestore();
  });

  it('should use console.debug for debug level', () => {
    const spy = jest.spyOn(console, 'debug').mockImplementation();
    const sink = new ConsoleSink();
    sink.write(makeEntry({ level: 'debug' }));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('should use console.debug for verbose level', () => {
    const spy = jest.spyOn(console, 'debug').mockImplementation();
    const sink = new ConsoleSink();
    sink.write(makeEntry({ level: 'verbose' }));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('should use console.warn for warn level', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation();
    const sink = new ConsoleSink();
    sink.write(makeEntry({ level: 'warn' }));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('should use console.error for error level', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation();
    const sink = new ConsoleSink();
    sink.write(makeEntry({ level: 'error' }));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('should use console.log for unknown level', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();
    const sink = new ConsoleSink();
    sink.write(makeEntry({ level: 'unknown' as any }));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('WinstonSink', () => {
  function createMockWinston() {
    return {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
  }

  it('should forward info logs to winston.info', () => {
    const logger = createMockWinston();
    const sink = new WinstonSink(logger);
    const entry = makeEntry({ level: 'info', trace_id: 'abc123' });
    sink.write(entry);

    expect(logger.info).toHaveBeenCalledWith(
      'test message',
      expect.objectContaining({
        timestamp: '2026-03-31T14:00:00.000Z',
        trace_id: 'abc123',
      }),
    );
  });

  it('should map verbose to winston.debug', () => {
    const logger = createMockWinston();
    const sink = new WinstonSink(logger);
    sink.write(makeEntry({ level: 'verbose' }));
    expect(logger.debug).toHaveBeenCalledTimes(1);
  });

  it('should map warn to winston.warn', () => {
    const logger = createMockWinston();
    const sink = new WinstonSink(logger);
    sink.write(makeEntry({ level: 'warn' }));
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('should map error to winston.error', () => {
    const logger = createMockWinston();
    const sink = new WinstonSink(logger);
    sink.write(makeEntry({ level: 'error' }));
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('should map unknown level to winston.info', () => {
    const logger = createMockWinston();
    const sink = new WinstonSink(logger);
    sink.write(makeEntry({ level: 'unknown' as any }));
    expect(logger.info).toHaveBeenCalledTimes(1);
  });
});

describe('PinoSink', () => {
  function createMockPino() {
    return {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
  }

  it('should forward info logs to pino.info(obj, msg)', () => {
    const logger = createMockPino();
    const sink = new PinoSink(logger);
    sink.write(makeEntry({ level: 'info', trace_id: 'abc' }));

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ timestamp: '2026-03-31T14:00:00.000Z', trace_id: 'abc' }),
      'test message',
    );
  });

  it('should map debug to pino.debug', () => {
    const logger = createMockPino();
    const sink = new PinoSink(logger);
    sink.write(makeEntry({ level: 'debug' }));
    expect(logger.debug).toHaveBeenCalledTimes(1);
  });

  it('should map verbose to pino.debug', () => {
    const logger = createMockPino();
    const sink = new PinoSink(logger);
    sink.write(makeEntry({ level: 'verbose' }));
    expect(logger.debug).toHaveBeenCalledTimes(1);
  });

  it('should map warn to pino.warn', () => {
    const logger = createMockPino();
    const sink = new PinoSink(logger);
    sink.write(makeEntry({ level: 'warn' }));
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('should map error to pino.error', () => {
    const logger = createMockPino();
    const sink = new PinoSink(logger);
    sink.write(makeEntry({ level: 'error' }));
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('should map unknown level to pino.info', () => {
    const logger = createMockPino();
    const sink = new PinoSink(logger);
    sink.write(makeEntry({ level: 'unknown' as any }));
    expect(logger.info).toHaveBeenCalledTimes(1);
  });
});

describe('CallbackSink', () => {
  it('should forward entries to the callback function', () => {
    const fn = jest.fn();
    const sink = new CallbackSink(fn);
    const entry = makeEntry();
    sink.write(entry);
    expect(fn).toHaveBeenCalledWith(entry);
  });
});
