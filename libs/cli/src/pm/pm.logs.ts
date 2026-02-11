/**
 * Log stream creation, rotation, tail, and follow utilities.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logFilePath, errorLogFilePath, ensurePmDirs, PM_DIRS } from './pm.paths';

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_ROTATED_FILES = 5;

export function createLogStreams(name: string): {
  stdout: fs.WriteStream;
  stderr: fs.WriteStream;
} {
  ensurePmDirs();
  const outPath = logFilePath(name);
  const errPath = errorLogFilePath(name);

  rotateIfNeeded(outPath);
  rotateIfNeeded(errPath);

  return {
    stdout: fs.createWriteStream(outPath, { flags: 'a' }),
    stderr: fs.createWriteStream(errPath, { flags: 'a' }),
  };
}

function rotateIfNeeded(filePath: string): void {
  try {
    if (!fs.existsSync(filePath)) return;
    const stat = fs.statSync(filePath);
    if (stat.size < MAX_LOG_SIZE) return;

    // Shift existing rotated files
    for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
      const from = `${filePath}.${i}`;
      const to = `${filePath}.${i + 1}`;
      if (fs.existsSync(from)) {
        if (i === MAX_ROTATED_FILES - 1) {
          fs.unlinkSync(from);
        } else {
          fs.renameSync(from, to);
        }
      }
    }

    // Rotate current file
    fs.renameSync(filePath, `${filePath}.1`);
  } catch {
    // ignore rotation errors
  }
}

export function tailLog(name: string, lines: number): string[] {
  const filePath = logFilePath(name);
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, 'utf-8');
  const allLines = content.split('\n');
  return allLines.slice(-lines).filter((l) => l.length > 0);
}

export function followLog(name: string, onLine: (line: string) => void): () => void {
  const filePath = logFilePath(name);
  ensurePmDirs();

  // Create the file if it doesn't exist
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '', 'utf-8');
  }

  let position = fs.statSync(filePath).size;

  const watcher = fs.watchFile(filePath, { interval: 300 }, () => {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size <= position) {
        // File was truncated or rotated
        position = 0;
      }
      if (stat.size > position) {
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(stat.size - position);
        fs.readSync(fd, buffer, 0, buffer.length, position);
        fs.closeSync(fd);
        position = stat.size;

        const chunk = buffer.toString('utf-8');
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.length > 0) onLine(line);
        }
      }
    } catch {
      // ignore read errors
    }
  });

  return () => {
    fs.unwatchFile(filePath);
  };
}

export function listLogFiles(name: string): string[] {
  const logsDir = PM_DIRS.logs;
  if (!fs.existsSync(logsDir)) return [];

  return fs
    .readdirSync(logsDir)
    .filter((f: string) => f.startsWith(name))
    .map((f: string) => path.join(logsDir, f));
}
