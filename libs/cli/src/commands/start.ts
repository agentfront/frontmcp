import * as path from 'path';
import { ParsedArgs } from '../args';
import { c } from '../colors';
import { resolveEntry } from '../utils/fs';
import { loadDevEnv } from '../utils/env';
import { ProcessManager, formatProcessDetail } from '../pm';

export async function runStart(opts: ParsedArgs): Promise<void> {
  const name = opts._[1];
  if (!name) {
    throw new Error('Missing process name. Usage: frontmcp start <name> --entry <path>');
  }

  const cwd = process.cwd();
  const entry = await resolveEntry(cwd, opts.entry);

  // Load environment variables
  loadDevEnv(cwd);

  const pm = new ProcessManager();

  console.log(`${c('cyan', '[pm]')} starting "${name}"...`);
  console.log(`${c('cyan', '[pm]')} entry: ${path.relative(cwd, entry)}`);

  const info = await pm.start({
    name,
    entry,
    port: opts.port,
    socket: !!opts.socket,
    socketPath: typeof opts.socket === 'string' ? opts.socket : undefined,
    dbPath: opts.db ? path.resolve(opts.db) : undefined,
    maxRestarts: opts.maxRestarts,
  });

  console.log(`\n${c('green', 'Started successfully:')}\n`);
  console.log(formatProcessDetail(info));

  if (info.socketPath) {
    console.log(`\n${c('gray', 'hint:')} test with: curl --unix-socket ${info.socketPath} http://localhost/health`);
  } else if (info.port) {
    console.log(`\n${c('gray', 'hint:')} test with: curl http://localhost:${info.port}/health`);
  }

  // Keep the supervisor process alive
  await new Promise<void>((resolve) => {
    process.once('SIGINT', async () => {
      console.log(`\n${c('yellow', '[pm]')} stopping "${name}"...`);
      await pm.stop(name);
      resolve();
    });
    process.once('SIGTERM', async () => {
      await pm.stop(name);
      resolve();
    });
  });
}
