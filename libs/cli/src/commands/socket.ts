import * as path from 'path';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';
import { ParsedArgs } from '../args';
import { c } from '../colors';
import { resolveEntry } from '../utils/fs';
import { loadDevEnv } from '../utils/env';
import { ProcessManager } from '../pm';

function ensureDir(dir: string): void {
  const fs = require('fs');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function resolveSocketPath(opts: ParsedArgs, entryPath: string): string {
  if (opts.socket) {
    return path.resolve(opts.socket);
  }

  // Default: ~/.frontmcp/sockets/{app-name}.sock
  const appName = path.basename(path.dirname(entryPath));
  const socketsDir = path.join(os.homedir(), '.frontmcp', 'sockets');
  ensureDir(socketsDir);
  return path.join(socketsDir, `${appName}.sock`);
}

function resolveDbPath(opts: ParsedArgs): string | undefined {
  if (!opts.db) return undefined;
  return path.resolve(opts.db);
}

export async function runSocket(opts: ParsedArgs): Promise<void> {
  const cwd = process.cwd();
  const entry = await resolveEntry(cwd, opts.entry ?? opts._[1]);

  // Load environment variables
  loadDevEnv(cwd);

  const socketPath = resolveSocketPath(opts, entry);
  const dbPath = resolveDbPath(opts);

  console.log(`${c('cyan', '[socket]')} entry: ${path.relative(cwd, entry)}`);
  console.log(`${c('cyan', '[socket]')} socket: ${socketPath}`);
  if (dbPath) {
    console.log(`${c('cyan', '[socket]')} db: ${dbPath}`);
  }

  if (opts.background) {
    // Background mode: delegate to ProcessManager
    const appName = path.basename(path.dirname(entry));
    console.log(`${c('gray', '[socket]')} starting via process manager...`);

    const pm = new ProcessManager();
    try {
      const info = await pm.start({
        name: appName,
        entry,
        socket: true,
        socketPath,
        dbPath,
      });

      console.log(`${c('green', '[socket]')} daemon started (PID: ${info.pid})`);
      console.log(`${c('gray', 'hint:')} test with: curl --unix-socket ${socketPath} http://localhost/health`);
      console.log(`${c('gray', 'hint:')} stop with: frontmcp stop ${appName}`);
    } catch (err) {
      // Fallback to legacy background spawn if PM fails
      console.log(`${c('yellow', '[socket]')} PM start failed, using legacy spawn...`);

      const args = ['socket', entry, '--socket', socketPath];
      if (dbPath) {
        args.push('--db', dbPath);
      }

      const child: ChildProcess = spawn(process.execPath, [__filename, ...args], {
        detached: true,
        stdio: 'ignore',
      });

      child.unref();
      console.log(`${c('green', '[socket]')} daemon started (PID: ${child.pid})`);
      console.log(`${c('gray', 'hint:')} test with: curl --unix-socket ${socketPath} http://localhost/health`);
    }
    return;
  }

  // Foreground mode: run directly via tsx (unchanged)
  console.log(`${c('gray', '[socket]')} starting in foreground mode...`);
  console.log(`${c('gray', 'hint:')} press Ctrl+C to stop`);
  console.log(`${c('gray', 'hint:')} test with: curl --unix-socket ${socketPath} http://localhost/health`);

  // Set environment variables for the child process
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    FRONTMCP_SOCKET_PATH: socketPath,
  };
  if (dbPath) {
    env['FRONTMCP_SQLITE_PATH'] = dbPath;
  }

  const app = spawn('npx', ['-y', 'tsx', '--conditions', 'node', entry], {
    stdio: 'inherit',
    shell: true,
    env,
  });

  const cleanup = () => {
    try {
      app.kill('SIGINT');
    } catch {
      // ignore
    }
  };

  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  await new Promise<void>((resolve, reject) => {
    app.on('close', () => {
      resolve();
    });
    app.on('error', (err) => {
      cleanup();
      reject(err);
    });
  });
}
