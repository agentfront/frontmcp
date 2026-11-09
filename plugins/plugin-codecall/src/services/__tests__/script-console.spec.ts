import type { FrontMcpLogger } from '@frontmcp/sdk';

import { ScriptConsoleLog } from '../script-console';

function recordingLogger() {
  const lines: Array<[string, string]> = [];
  const at = (level: string) => (message: string) => void lines.push([level, message]);
  const logger = { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug') };
  return { lines, logger: logger as unknown as FrontMcpLogger };
}

describe('ScriptConsoleLog', () => {
  it('writes log and info at info, and warn, error and debug at their own level', () => {
    const { lines, logger } = recordingLogger();
    const { write } = new ScriptConsoleLog(logger);

    write('log', 'a');
    write('info', 'b');
    write('warn', 'c');
    write('error', 'd');
    write('debug', 'e');

    expect(lines).toEqual([
      ['info', 'a'],
      ['info', 'b'],
      ['warn', 'c'],
      ['error', 'd'],
      ['debug', 'e'],
    ]);
  });

  it('drops lines past the limit for the rest of the second, saying so once, then writes again', () => {
    const { lines, logger } = recordingLogger();
    let now = 10_000;
    const { write } = new ScriptConsoleLog(logger, 2, () => now);

    write('log', '1');
    write('log', '2');
    write('log', '3');
    write('log', '4');
    now += 999;
    write('log', '5');
    now += 1;
    write('log', '6');

    expect(lines).toEqual([
      ['info', '1'],
      ['info', '2'],
      ['warn', 'Dropping script console output: more than 2 lines a second'],
      ['info', '6'],
    ]);
  });
});
