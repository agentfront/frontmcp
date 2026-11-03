/** Send every stdout-bound console method to stderr: on a stdio transport, stdout carries only JSON-RPC frames. */
export function redirectConsoleToStderr(): void {
  const { Console } = require('node:console') as typeof import('node:console');
  const stderrConsole = new Console({ stdout: process.stderr, stderr: process.stderr });
  console.log = stderrConsole.log.bind(stderrConsole);
  console.info = stderrConsole.info.bind(stderrConsole);
  console.debug = stderrConsole.debug.bind(stderrConsole);
  console.dir = stderrConsole.dir.bind(stderrConsole);
  console.table = stderrConsole.table.bind(stderrConsole);
  console.time = stderrConsole.time.bind(stderrConsole);
  console.timeLog = stderrConsole.timeLog.bind(stderrConsole);
  console.group = stderrConsole.group.bind(stderrConsole);
  console.groupEnd = stderrConsole.groupEnd.bind(stderrConsole);
  console.count = stderrConsole.count.bind(stderrConsole);
}
