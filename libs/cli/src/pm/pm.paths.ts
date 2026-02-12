/**
 * Path resolution for Process Manager directories and files.
 * All PM state lives under ~/.frontmcp/
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const FRONTMCP_HOME = path.join(os.homedir(), '.frontmcp');

export const PM_DIRS = {
  root: FRONTMCP_HOME,
  pids: path.join(FRONTMCP_HOME, 'pids'),
  logs: path.join(FRONTMCP_HOME, 'logs'),
  sockets: path.join(FRONTMCP_HOME, 'sockets'),
  services: path.join(FRONTMCP_HOME, 'services'),
  apps: path.join(FRONTMCP_HOME, 'apps'),
  data: path.join(FRONTMCP_HOME, 'data'),
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
