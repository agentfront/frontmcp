/**
 * Path resolution for Process Manager directories and files.
 * All PM state lives under ~/.frontmcp/
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const FRONTMCP_HOME = path.join(os.homedir(), '.frontmcp');
const GROUP_OR_OTHER_WRITE = 0o022;

export const PM_DIRS = {
  root: FRONTMCP_HOME,
  pids: path.join(FRONTMCP_HOME, 'pids'),
  logs: path.join(FRONTMCP_HOME, 'logs'),
  sockets: path.join(FRONTMCP_HOME, 'sockets'),
  services: path.join(FRONTMCP_HOME, 'services'),
  apps: path.join(FRONTMCP_HOME, 'apps'),
  data: path.join(FRONTMCP_HOME, 'data'),
  esmCache: path.join(FRONTMCP_HOME, 'esm-cache'),
} as const;

export function pidFilePath(name: string): string {
  return path.join(PM_DIRS.pids, `${name}.pid`);
}

export function logFilePath(name: string): string {
  return path.join(PM_DIRS.logs, `${name}.log`);
}

export function errorLogFilePath(name: string): string {
  return path.join(PM_DIRS.logs, `${name}.error.log`);
}

export function socketFilePath(name: string): string {
  return path.join(PM_DIRS.sockets, `${name}.sock`);
}

export function appDir(name: string): string {
  return path.join(PM_DIRS.apps, name);
}

export function registryPath(): string {
  return path.join(FRONTMCP_HOME, 'registry.json');
}

export function ensurePmDirs(): void {
  for (const dir of Object.values(PM_DIRS)) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

/** The server refuses a socket others could replace, so ~/.frontmcp is not writable by others and its sockets are owner-only. */
export function ensureSocketsDir(): void {
  fs.mkdirSync(PM_DIRS.sockets, { recursive: true, mode: 0o700 });
  const rootMode = fs.statSync(PM_DIRS.root).mode & 0o7777;
  if (rootMode & GROUP_OR_OTHER_WRITE) fs.chmodSync(PM_DIRS.root, rootMode & ~GROUP_OR_OTHER_WRITE);
  if (fs.lstatSync(PM_DIRS.sockets).isSymbolicLink()) {
    throw new Error(
      `Refusing to use ${PM_DIRS.sockets}: it is a symlink. Replace it with a directory only you can write to.`,
    );
  }
  fs.chmodSync(PM_DIRS.sockets, 0o700);
}
