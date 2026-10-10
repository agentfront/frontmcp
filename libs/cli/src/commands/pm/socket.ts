import { spawn, type ChildProcess } from 'child_process';
import * as os from 'os';
import * as path from 'path';

import { type ParsedArgs } from '../../core/args';
import { c } from '../../core/colors';
import { loadDevEnv } from '../../shared/env';
import { resolveEntry } from '../../shared/fs';
import { projectToolCommand, spawnTool } from '../../shared/tool-command';
import { loadShipEnv } from './ship-env';

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

function writePidFile(socketPath: string): string {
  const pidPath = socketPath + '.pid';
  const fs = require('fs');
  fs.writeFileSync(pidPath, String(process.pid), 'utf-8');
  return pidPath;
}

function cleanupPidFile(socketPath: string): void {
  const pidPath = socketPath + '.pid';
  try {
    const fs = require('fs');
    if (fs.existsSync(pidPath)) {
      fs.unlinkSync(pidPath);
    }
  } catch {
    // ignore
  }
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
    // Background mode: spawn detached process
    console.log(`${c('gray', '[socket]')} starting in background mode...`);

    const args = ['socket', entry, '--socket', socketPath];
    if (dbPath) {
      args.push('--db', dbPath);
    }

    // Re-invoke frontmcp without --background flag
    const scriptPath = process.argv[1];
    if (!scriptPath) {
      throw new Error('Cannot determine script path from process.argv[1] for background spawn');
    }
    const child: ChildProcess = spawn(process.execPath, [scriptPath, ...args], {
      detached: true,
      stdio: 'ignore',
    });

    child.unref();
    console.log(`${c('green', '[socket]')} daemon started (PID: ${child.pid})`);
    console.log(`${c('gray', 'hint:')} test with: curl --unix-socket ${socketPath} http://localhost/health`);
    return;
  }

  // Foreground mode: run directly via tsx
  console.log(`${c('gray', '[socket]')} starting in foreground mode...`);
  console.log(`${c('gray', 'hint:')} press Ctrl+C to stop`);
  console.log(`${c('gray', 'hint:')} test with: curl --unix-socket ${socketPath} http://localhost/health`);

  // Set environment variables for the child process: frontmcp.config `env.shared` ⊕ `env.ship`
  // under the real environment (incl. .env), which wins
  const shipEnv = await loadShipEnv(entry, 'pm:socket', typeof opts.config === 'string' ? opts.config : undefined);
  const env: Record<string, string> = {
    ...shipEnv,
    ...(process.env as Record<string, string>),
    FRONTMCP_DAEMON_SOCKET: socketPath,
  };
  if (dbPath) {
    env['FRONTMCP_SQLITE_PATH'] = dbPath;
  }

  writePidFile(socketPath);

  // #731 — the project's tsx run with node (npx when it is not installed); no shell, so it starts on Windows too.
  const app = spawnTool(projectToolCommand({ package: 'tsx', npx: ['-y', 'tsx'] }, ['--conditions', 'node', entry]), {
    stdio: 'inherit',
    env,
  });

  const cleanup = () => {
    try {
      app.kill('SIGINT');
    } catch {
      // ignore
    }
    cleanupPidFile(socketPath);
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
      cleanupPidFile(socketPath);
      resolve();
    });
    app.on('error', (err) => {
      cleanup();
      reject(err);
    });
  });
}
