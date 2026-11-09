/**
 * Where a script's `console` calls go with `vm.allowConsole: true`: the server's logger, at most
 * {@link SCRIPT_CONSOLE_LINES_PER_SECOND} lines a second across every script of the server.
 *
 * @module @frontmcp/plugin-codecall
 */

import type { ConsoleLevel } from '@enclave-vm/core';

import type { FrontMcpLogger } from '@frontmcp/sdk';

/** Script console lines one server writes a second, across all its scripts; the rest of that second's are dropped. */
export const SCRIPT_CONSOLE_LINES_PER_SECOND = 50;

const WINDOW_MS = 1000;

/** The logger level of each console method: `log` and `info` both write at info. */
const LOGGER_LEVEL: Record<ConsoleLevel, 'info' | 'warn' | 'error' | 'debug'> = {
  log: 'info',
  info: 'info',
  warn: 'warn',
  error: 'error',
  debug: 'debug',
};

/**
 * Writes script console lines to a logger, within a per-server rate limit. The sandbox has already bounded each
 * script's calls and bytes (`maxConsoleCalls`, `maxConsoleOutputBytes`); this bounds the server as a whole, so many
 * scripts at once can't flood its logs. The first line dropped in a second is reported once, at warn.
 */
export class ScriptConsoleLog {
  private windowStart = Number.NEGATIVE_INFINITY;
  private written = 0;
  private dropped = 0;

  constructor(
    private readonly logger: FrontMcpLogger,
    private readonly linesPerSecond = SCRIPT_CONSOLE_LINES_PER_SECOND,
    private readonly now: () => number = Date.now,
  ) {}

  /** The `consoleHandler` the sandbox calls with each formatted line. */
  readonly write = (level: ConsoleLevel, message: string): void => {
    const now = this.now();
    if (now - this.windowStart >= WINDOW_MS) {
      this.windowStart = now;
      this.written = 0;
      this.dropped = 0;
    }
    if (this.written >= this.linesPerSecond) {
      this.dropped++;
      if (this.dropped === 1) {
        this.logger.warn(`Dropping script console output: more than ${this.linesPerSecond} lines a second`);
      }
      return;
    }
    this.written++;
    this.logger[LOGGER_LEVEL[level]](message);
  };
}
