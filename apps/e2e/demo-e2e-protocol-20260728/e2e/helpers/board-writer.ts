/** Run `src/board-writer.ts` as another process, which writes the board to the shared SQLite store. */
import { execFile } from 'node:child_process';
import { join } from 'node:path';

const workspaceRoot = join(__dirname, '..', '..', '..', '..', '..');
const writerScript = join(__dirname, '..', '..', 'src', 'board-writer.ts');

export interface WrittenBoard {
  value: { open: number; note: string };
  revision: number;
  updatedAt: string;
}

export function writeBoardFromAnotherProcess(boardDb: string, value: WrittenBoard['value']): Promise<WrittenBoard> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ['--import', 'tsx', writerScript, JSON.stringify(value)],
      { cwd: workspaceRoot, env: { ...process.env, BOARD_DB: boardDb }, timeout: 90_000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`the board writer failed: ${error.message}\n${stderr}`));
          return;
        }
        const lines = stdout.trim().split('\n');
        resolve(JSON.parse(lines[lines.length - 1] ?? '{}') as WrittenBoard);
      },
    );
  });
}
