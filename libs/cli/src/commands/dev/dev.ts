import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { ParsedArgs } from '../../core/args';
import { c } from '../../core/colors';
import { resolveEntry } from '../../shared/fs';
import { loadDevEnv } from '../../shared/env';

function killQuiet(proc?: ChildProcess, signal: NodeJS.Signals = 'SIGINT') {
  try {
    if (proc && !proc.killed) {
      proc.kill(signal);
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

  // Use --conditions node to ensure proper Node.js module resolution
  // This helps with dynamic require() calls in packages like ioredis
  // Only use shell on Windows where npx.cmd requires it; on Unix, direct spawn
  // allows proper SIGINT propagation without intermediate shell processes
  const useShell = process.platform === 'win32';
  const app = spawn('npx', ['-y', 'tsx', '--conditions', 'node', '--watch', entry], {
    stdio: 'inherit',
    shell: useShell,
  });
  const checker = spawn('npx', ['-y', 'tsc', '--noEmit', '--pretty', '--watch'], {
    stdio: 'inherit',
    shell: useShell,
  });

  const cleanup = () => {
    killQuiet(checker);
    killQuiet(app);
  };

  process.on('SIGINT', () => {
    cleanup();
    // Force-kill after 2s if children haven't exited
    const timer = setTimeout(() => {
      killQuiet(checker, 'SIGKILL');
      killQuiet(app, 'SIGKILL');
      process.exit(1);
    }, 2000);
    timer.unref();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
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
