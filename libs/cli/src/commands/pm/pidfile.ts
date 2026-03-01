/**
 * PID file CRUD + process liveness checks.
 */

import * as fs from 'fs';
import { pidFilePath, ensurePmDirs, PM_DIRS } from './paths';
import { PidFileData } from './types';

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
    return JSON.parse(content) as PidFileData;
  } catch {
    return null;
  }
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
