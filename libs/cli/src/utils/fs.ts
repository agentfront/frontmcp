import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { c } from '../colors';

export async function fileExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readJSON<T = any>(jsonPath: string): Promise<T | null> {
  try {
    const buf = await fsp.readFile(jsonPath, 'utf8');
    return JSON.parse(buf) as T;
  } catch {
    return null;
  }
}

export async function writeJSON(p: string, obj: any) {
  await fsp.writeFile(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function tryCandidates(base: string): string[] {
  const exts = ['', '.ts', '.tsx', '.js', '.mjs', '.cjs'];
  return exts.map((ext) => base + ext);
}

export async function resolveEntry(cwd: string, explicit?: string): Promise<string> {
  if (explicit) {
    const full = path.resolve(cwd, explicit);
    if (await fileExists(full)) return full;
    throw new Error(`Entry override not found: ${explicit}`);
  }

  const pkgPath = path.join(cwd, 'package.json');
  if (await fileExists(pkgPath)) {
    const pkg = await readJSON<any>(pkgPath);
    if (pkg && typeof pkg.main === 'string' && pkg.main.trim()) {
      const mainCandidates = tryCandidates(path.resolve(cwd, pkg.main));
      for (const p of mainCandidates) {
        if (await fileExists(p)) return p;
      }
      const asDir = path.resolve(cwd, pkg.main);
      const idxCandidates = tryCandidates(path.join(asDir, 'index'));
      for (const p of idxCandidates) {
        if (await fileExists(p)) return p;
      }
    }
  }

  const fallback = path.join(cwd, 'src', 'main.ts');
  if (await fileExists(fallback)) return fallback;

  const msg = [
    c('red', 'No entry file found.'),
    '',
    'I looked for:',
    `  • ${pkgPath} with a valid "main" field`,
    `  • ${path.relative(cwd, fallback)}`,
    '',
    'Please create an entry file (e.g. src/main.ts) or set "main" in package.json,',
    'or run with an explicit path:',
    `  frontmcp dev --entry src/main.ts`,
  ].join('\n');
  throw new Error(msg);
}

export function runCmd(cmd: string, args: string[], opts: { cwd?: string } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: false, ...opts });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`))));
    child.on('error', reject);
  });
}

export async function ensureDir(p: string): Promise<void> {
  await fsp.mkdir(p, { recursive: true });
}

export async function isDirEmpty(dir: string): Promise<boolean> {
  try {
    const items = await fsp.readdir(dir);
    return items.length === 0;
  } catch (e: any) {
    if (e?.code === 'ENOENT') return true;
    throw e;
  }
}

export { fsp }; // re-export if needed in other modules
