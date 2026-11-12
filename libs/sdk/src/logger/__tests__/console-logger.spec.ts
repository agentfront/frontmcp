import { format } from 'node:util';

import { LogLevel, type LogRecord } from '../../common';
import { ConsoleLogTransportInstance } from '../instances/instance.console-logger';

function record(message: string, args: unknown[] = []): LogRecord {
  return { level: LogLevel.Info, levelName: 'info', message, args, timestamp: new Date(), prefix: 'Scope' };
}

describe('ConsoleLogTransportInstance', () => {
  let consoleInfo: jest.SpyInstance;

  beforeEach(() => {
    consoleInfo = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleInfo.mockRestore();
  });

  /** The text the console printed after the record's time, scope and level. */
  function printed(): unknown[] {
    return consoleInfo.mock.calls[0].slice(1);
  }

  it('keeps a multi-line message multi-line, with every line after the first indented', () => {
    new ConsoleLogTransportInstance().log(record('Hook order:\n  pre: a\n  execute: b'));

    expect(printed()).toEqual(['Hook order:\n    pre: a\n    execute: b']);
  });

  it('a line break in a message cannot start a line that looks like another record', () => {
    new ConsoleLogTransportInstance().log(record('tools/call: x\n[12:00:00.000] [FrontMcp] ERROR forged\r\nentry'));

    const [text] = printed() as string[];
    const [, ...continuation] = text.split('\n');
    expect(continuation).toEqual(['  [12:00:00.000] [FrontMcp] ERROR forged', '  entry']);
  });

  it('prints other control characters as visible escapes', () => {
    new ConsoleLogTransportInstance().log(record('a\rb\u001b[2Jc\u0007d e\tf'));

    expect(printed()).toEqual(['a\\rb\\u001b[2Jc\\u0007d\\u2028e\tf']);
  });

  it('formats string arguments like the message and leaves other values to the console', () => {
    const details = { uri: 'x\ny' };
    new ConsoleLogTransportInstance().log(record('lookup', ['a\nb\u001b', details, 3]));

    expect(printed()).toEqual(['lookup', 'a\n  b\\u001b', details, 3]);
  });

  it('prints a logger name as text: its control characters escaped and a % in it not taken as a format directive', () => {
    new ConsoleLogTransportInstance().log({ ...record('found'), prefix: 'ReadResourceFlow(file:///caf%c3%a9\nX)' });

    const line = format(...(consoleInfo.mock.calls[0] as unknown[]));
    expect(line).toContain('[ReadResourceFlow(file:///caf%c3%a9\\nX)]');
    expect(line).toMatch(/found$/);
  });

  it('formats what the bound development logger prints the same way', () => {
    new ConsoleLogTransportInstance().bind(LogLevel.Info, 'Scope')('tools/call: x\n[forged]', 'y\rz');

    expect(printed()).toEqual(['tools/call: x\n  [forged]', 'y\\rz']);
  });
});
