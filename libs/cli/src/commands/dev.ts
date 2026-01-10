import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { ParsedArgs } from '../args';
import { c } from '../colors';
import { resolveEntry } from '../utils/fs';
import { loadDevEnv } from '../utils/env';

function killQuiet(proc?: ChildProcess) {
  try {
    if (proc) {
      proc.kill('SIGINT');
    }
  } catch {
    // ignore
  }
}

export async function runDev(opts: ParsedArgs): Promise<void> {
  const cwd = process.cwd();
  const entry = await resolveEntry(cwd, opts.entry);

  // Load .env and .env.local files before starting the server
  loadDevEnv(cwd);

  console.log(`${c('cyan', '[dev]')} using entry: ${path.relative(cwd, entry)}`);
  console.log(
    `${c('gray', '[dev]')} starting ${c('bold', 'tsx --watch')} and ${c(
      'bold',
      'tsc --noEmit --watch',
    )} (async type-checker)`,
  );
  console.log(`${c('gray', 'hint:')} press Ctrl+C to stop`);

  const app = spawn('npx', ['-y', 'tsx', '--watch', entry], { stdio: 'inherit', shell: true });
  const checker = spawn('npx', ['-y', 'tsc', '--noEmit', '--pretty', '--watch'], {
    stdio: 'inherit',
    shell: true,
  });

  const cleanup = () => {
    killQuiet(checker);
    killQuiet(app);
  };

  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });

  await new Promise<void>((resolve, reject) => {
    app.on('close', () => {
      cleanup();
      resolve();
    });
    app.on('error', (err) => {
      cleanup();
      reject(err);
    });
  });
}
