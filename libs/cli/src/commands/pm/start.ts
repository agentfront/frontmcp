import * as fs from 'fs';
import * as path from 'path';

import { formatProcessDetail, ProcessManager } from '.';
import { type ParsedArgs } from '../../core/args';
import { c } from '../../core/colors';
import { loadDevEnv } from '../../shared/env';
import { resolveEntry } from '../../shared/fs';
import { getRegisteredApp } from '../package/registry';
import { superviseUntilSignalled } from './keep-alive';
import { loadShipEnv } from './ship-env';

function resolveInstalledBundle(name: string, bundle: string): string {
  if (!fs.existsSync(bundle)) {
    throw new Error(
      `Installed app "${name}" is missing its bundle at ${bundle}. Reinstall it with "frontmcp install".`,
    );
  }
  return bundle;
}

export async function runStart(opts: ParsedArgs): Promise<void> {
  const name = opts._[1];
  if (!name) {
    throw new Error('Missing process name. Usage: frontmcp start <name> --entry <path>');
  }

  // `frontmcp install` registers apps by name; start them from their install
  // directory (bundle + the .env the installer wrote) unless --entry overrides.
  const installed = opts.entry ? null : getRegisteredApp(name);
  const cwd = installed ? installed.installDir : process.cwd();
  const entry = installed ? resolveInstalledBundle(name, installed.bundle) : await resolveEntry(cwd, opts.entry);

  // Load environment variables
  loadDevEnv(cwd);
  // frontmcp.config `env.shared` ⊕ `env.ship`; the real environment (incl. .env) still wins
  const shipEnv = installed ? {} : await loadShipEnv(entry, 'pm:start', typeof opts.config === 'string' ? opts.config : undefined);

  const pm = new ProcessManager();

  console.log(`${c('cyan', '[pm]')} starting "${name}"...`);
  console.log(`${c('cyan', '[pm]')} entry: ${path.relative(cwd, entry)}`);

  const info = await pm.start({
    name,
    entry,
    port: opts.port ?? installed?.port,
    socket: !!opts.socket,
    socketPath: typeof opts.socket === 'string' ? opts.socket : undefined,
    dbPath: opts.db ? path.resolve(opts.db) : undefined,
    maxRestarts: opts.maxRestarts,
    env: { ...shipEnv, ...(process.env as Record<string, string>) },
  });

  console.log(`\n${c('green', 'Started successfully:')}\n`);
  console.log(formatProcessDetail(info));

  if (info.socketPath) {
    console.log(`\n${c('gray', 'hint:')} test with: curl --unix-socket ${info.socketPath} http://localhost/health`);
  } else if (info.port) {
    console.log(`\n${c('gray', 'hint:')} test with: curl http://localhost:${info.port}/health`);
  }

  await superviseUntilSignalled(pm, name);
}
