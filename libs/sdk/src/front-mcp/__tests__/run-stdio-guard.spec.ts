/**
 * FrontMcpInstance.runStdio() startup-guard reset.
 *
 * runStdio sets the module-level `stdioServing` guard to `true` BEFORE
 * initialization completes (it must, to block a re-entrant second call during
 * the first `await`). If initialization then throws before the stdio transport
 * is attached, the guard must be reset to `false` — otherwise a failed startup
 * leaves it permanently "serving", and every retry in the same process is
 * silently ignored ("runStdio() called more than once"), turning a recoverable
 * startup error into a dead process. (CodeRabbit review on the #474 work.)
 *
 * Unlike the input-resolution spec, this drives runStdio PAST the guard, so it
 * triggers the console redirect + FRONTMCP_STDIO env mutation; both are
 * saved/restored so a failed startup here can't leak into other tests.
 */
import 'reflect-metadata';

import { FrontMcpInstance } from '../front-mcp';

describe('FrontMcpInstance.runStdio — startup guard reset', () => {
  const savedConsole = {
    log: console.log,
    info: console.info,
    debug: console.debug,
    dir: console.dir,
    table: console.table,
    time: console.time,
    timeLog: console.timeLog,
    group: console.group,
    groupEnd: console.groupEnd,
    count: console.count,
  };
  const savedStdioEnv = process.env['FRONTMCP_STDIO'];

  afterEach(() => {
    Object.assign(console, savedConsole);
    if (savedStdioEnv === undefined) {
      delete process.env['FRONTMCP_STDIO'];
    } else {
      process.env['FRONTMCP_STDIO'] = savedStdioEnv;
    }
  });

  // A plain config object passes resolveConfigInput (only classes are validated
  // there), then fails inside the guarded `try` at schema parse (`apps` must be
  // an array) — i.e. AFTER the guard is set but BEFORE a transport is attached.
  const badConfig = { info: { name: 't', version: '1.0.0' }, apps: 'not-an-array' } as never;

  const runOutcome = (config: never): Promise<'resolved' | 'threw'> =>
    FrontMcpInstance.runStdio(config).then(
      () => 'resolved' as const,
      () => 'threw' as const,
    );

  it('resets the guard after a failed startup so a retry is not silently ignored', async () => {
    // First attempt fails during config parse (after stdioServing = true).
    expect(await runOutcome(badConfig)).toBe('threw');

    // Before the fix, the guard stayed stuck `true`, so this retry hit the
    // "called more than once" guard and resolved to undefined. After the fix the
    // guard was reset, so the retry re-attempts and throws again.
    expect(await runOutcome(badConfig)).toBe('threw');
  });
});
