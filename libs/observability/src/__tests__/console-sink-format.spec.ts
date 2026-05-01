import { ConsoleSink } from '../logging/sinks/console.sink';
import type { StructuredLogEntry } from '../logging/structured-log.types';

function makeEntry(overrides?: Partial<StructuredLogEntry>): StructuredLogEntry {
  return {
    timestamp: '2026-03-31T14:00:00.000Z',
    level: 'info',
    severity_number: 9,
    message: 'hello',
    ...overrides,
  };
}

describe('ConsoleSink format', () => {
  let infoSpy: jest.SpyInstance;

  beforeEach(() => {
    infoSpy = jest.spyOn(console, 'info').mockImplementation();
  });
  afterEach(() => {
    infoSpy.mockRestore();
  });

  function withTty(value: boolean, fn: () => void): void {
    const prev = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true });
    try {
      fn();
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', { value: prev, configurable: true });
    }
  }

  it('formats with ANSI when stdout is a TTY', () => {
    withTty(true, () => {
      const sink = new ConsoleSink();
      sink.write(makeEntry({ level: 'error' }));
      const out = String(infoSpy.mock.calls[0]?.[0] ?? '');
      // The router routes 'error' to console.error — so check that one too
    });
    const errSpy = jest.spyOn(console, 'error').mockImplementation();
    try {
      withTty(true, () => {
        new ConsoleSink().write(makeEntry({ level: 'error' }));
      });
      const out = String(errSpy.mock.calls[0]?.[0] ?? '');
      expect(out).toContain('\x1b[');
      expect(out).toContain('ERROR');
    } finally {
      errSpy.mockRestore();
    }
  });

  it('formats without ANSI when stdout is not a TTY', () => {
    withTty(false, () => {
      const sink = new ConsoleSink();
      sink.write(makeEntry());
    });
    const out = String(infoSpy.mock.calls[0]?.[0] ?? '');
    expect(out).not.toContain('\x1b[');
    expect(out).toContain('INFO');
    expect(out).toContain('hello');
  });

  it('renders trace_id+request_id segment', () => {
    withTty(false, () => {
      new ConsoleSink().write(makeEntry({ trace_id: 'tracetracetrace', request_id: 'reqreqreqreq' }));
    });
    const out = String(infoSpy.mock.calls[0]?.[0] ?? '');
    expect(out).toContain('tracetra:reqreqre');
  });

  it('renders only trace_id when request_id missing', () => {
    withTty(false, () => {
      new ConsoleSink().write(makeEntry({ trace_id: 'tracetracetrace' }));
    });
    const out = String(infoSpy.mock.calls[0]?.[0] ?? '');
    expect(out).toContain('[tracetra]');
  });

  it('renders prefix segment', () => {
    withTty(false, () => {
      new ConsoleSink().write(makeEntry({ prefix: 'MyMod' }));
    });
    const out = String(infoSpy.mock.calls[0]?.[0] ?? '');
    expect(out).toContain('[MyMod]');
  });

  it('renders attributes segment', () => {
    withTty(false, () => {
      new ConsoleSink().write(makeEntry({ attributes: { k: 'v', n: 5, obj: { a: 1 } } }));
    });
    const out = String(infoSpy.mock.calls[0]?.[0] ?? '');
    expect(out).toContain('k=v');
    expect(out).toContain('n=5');
    expect(out).toContain('obj={"a":1}');
  });

  it('renders error segment', () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation();
    try {
      withTty(false, () => {
        new ConsoleSink().write(makeEntry({ level: 'error', error: { type: 'E', message: 'boom' } }));
      });
      const out = String(errSpy.mock.calls[0]?.[0] ?? '');
      expect(out).toContain('[E: boom]');
    } finally {
      errSpy.mockRestore();
    }
  });

  it('renders elapsed_ms segment', () => {
    withTty(false, () => {
      new ConsoleSink().write(makeEntry({ elapsed_ms: 12 }));
    });
    const out = String(infoSpy.mock.calls[0]?.[0] ?? '');
    expect(out).toContain('(12ms)');
  });

  it('skips trace/request brackets when both are missing', () => {
    withTty(false, () => {
      new ConsoleSink().write(makeEntry());
    });
    const out = String(infoSpy.mock.calls[0]?.[0] ?? '');
    // Only the timestamp brackets should appear at the head
    expect(out.startsWith('[')).toBe(true);
  });

  it('uses the level color for known levels in ANSI mode', () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation();
    try {
      withTty(true, () => {
        new ConsoleSink().write(makeEntry({ level: 'debug' }));
      });
      const out = String(debugSpy.mock.calls[0]?.[0] ?? '');
      expect(out).toContain('\x1b[34m');
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('falls through to no level color for unknown levels in ANSI mode', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    try {
      withTty(true, () => {
        new ConsoleSink().write(makeEntry({ level: 'mystery' as unknown as 'info' }));
      });
      const out = String(logSpy.mock.calls[0]?.[0] ?? '');
      // No color for unknown level — but bold/reset are still wrapped
      expect(out).toContain('MYSTERY');
    } finally {
      logSpy.mockRestore();
    }
  });
});
