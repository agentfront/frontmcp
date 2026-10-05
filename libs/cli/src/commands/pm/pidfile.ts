/**
 * PID file CRUD + process liveness checks.
 */

import * as fs from 'fs';

import { ensurePmDirs, pidFilePath, PM_DIRS } from './paths';
import { type PidFileData } from './types';

export function writePidFile(name: string, data: PidFileData): string {
  ensurePmDirs();
  const filePath = pidFilePath(name);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return filePath;
}

export function readPidFile(name: string): PidFileData | null {
  const filePath = pidFilePath(name);
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    return normalizePidFileData(name, JSON.parse(content) as Partial<PidFileData>);
  } catch {
    return null;
  }
}

// Compiled CLI daemons write only pid, startedAt and port/socketPath.
function normalizePidFileData(name: string, data: Partial<PidFileData>): PidFileData | null {
  if (typeof data.pid !== 'number') return null;
  return {
    ...data,
    pid: data.pid,
    name: data.name ?? name,
    entry: data.entry ?? '',
    startedAt: data.startedAt ?? '',
    restartCount: data.restartCount ?? 0,
    supervisorPid: data.supervisorPid ?? data.pid,
    cliVersion: data.cliVersion ?? '',
  };
}

export function removePidFile(name: string): void {
  const filePath = pidFilePath(name);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // ignore
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function listPidFiles(): PidFileData[] {
  ensurePmDirs();
  const pidsDir = PM_DIRS.pids;
  try {
    const files = fs.readdirSync(pidsDir).filter((f: string) => f.endsWith('.pid'));
    const results: PidFileData[] = [];
    for (const file of files) {
      const name = file.replace(/\.pid$/, '');
      const data = readPidFile(name);
      if (data) results.push(data);
    }
    return results;
  } catch {
    return [];
  }
}
