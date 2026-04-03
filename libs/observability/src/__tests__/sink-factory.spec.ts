import { createSink, createSinks } from '../logging/sink.factory';
import { StdoutSink } from '../logging/sinks/stdout.sink';
import { ConsoleSink } from '../logging/sinks/console.sink';
import { CallbackSink } from '../logging/sinks/callback.sink';

describe('createSink', () => {
  it('should create StdoutSink for type stdout', () => {
    const sink = createSink({ type: 'stdout' });
    expect(sink).toBeInstanceOf(StdoutSink);
  });

  it('should create StdoutSink with custom stream', () => {
    const stream = { write: jest.fn().mockReturnValue(true) } as unknown as NodeJS.WritableStream;
    const sink = createSink({ type: 'stdout', stream });
    expect(sink).toBeInstanceOf(StdoutSink);
  });

  it('should create ConsoleSink for type console', () => {
    const sink = createSink({ type: 'console' });
    expect(sink).toBeInstanceOf(ConsoleSink);
  });

  it('should create CallbackSink for type callback', () => {
    const fn = jest.fn();
    const sink = createSink({ type: 'callback', fn });
    expect(sink).toBeInstanceOf(CallbackSink);
  });

  it('should create WinstonSink for type winston', () => {
    const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const sink = createSink({ type: 'winston', logger });
    expect(sink.constructor.name).toBe('WinstonSink');
  });

  it('should create PinoSink for type pino', () => {
    const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const sink = createSink({ type: 'pino', logger });
    expect(sink.constructor.name).toBe('PinoSink');
  });

  it('should create OtlpSink for type otlp', () => {
    const sink = createSink({ type: 'otlp', endpoint: 'http://localhost:4318' });
    expect(sink.constructor.name).toBe('OtlpSink');
  });

  it('should throw for unknown sink type', () => {
    expect(() => createSink({ type: 'unknown' } as any)).toThrow('Unknown sink type');
  });
});

describe('createSinks', () => {
  it('should create sinks from config array', () => {
    const sinks = createSinks([{ type: 'stdout' }, { type: 'console' }]);
    expect(sinks).toHaveLength(2);
    expect(sinks[0]).toBeInstanceOf(StdoutSink);
    expect(sinks[1]).toBeInstanceOf(ConsoleSink);
  });

  it('should default to StdoutSink in Node.js environment', () => {
    const sinks = createSinks();
    expect(sinks).toHaveLength(1);
    // In Node.js test environment, should default to StdoutSink
    expect(sinks[0]).toBeInstanceOf(StdoutSink);
  });

  it('should default to StdoutSink when empty array', () => {
    const sinks = createSinks([]);
    // Empty array = use defaults
    expect(sinks).toHaveLength(1);
  });

  it('should default to ConsoleSink in browser environment', () => {
    // Simulate browser: define window, undefine process
    const origProcess = globalThis.process;
    const origWindow = (globalThis as any).window;
    (globalThis as any).window = {};
    // Need to delete process to simulate browser
    delete (globalThis as any).process;

    // Re-require to get fresh module evaluation
    jest.resetModules();
    const { createSinks: freshCreateSinks } = require('../logging/sink.factory');
    const sinks = freshCreateSinks();
    expect(sinks).toHaveLength(1);
    expect(sinks[0].constructor.name).toBe('ConsoleSink');

    // Restore
    globalThis.process = origProcess;
    if (origWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = origWindow;
    }
  });
});
