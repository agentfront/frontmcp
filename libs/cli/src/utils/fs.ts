// file: libs/cli/src/utils/fs.ts
// CLI-specific file system utilities

import * as path from 'path';
import { promises as fsp } from 'fs';
import { c } from '../colors';
import { fileExists, readJSON } from '@frontmcp/utils';

function tryCandidates(base: string): string[] {
  const exts = ['', '.ts', '.tsx', '.js', '.mjs', '.cjs'];
  return exts.map((ext) => base + ext);
}

/**
 * Resolve entry file for CLI commands.
 * CLI-specific: includes colored error messages and CLI usage hints.
 */
export async function resolveEntry(cwd: string, explicit?: string): Promise<string> {
  if (explicit) {
    const full = path.resolve(cwd, explicit);
    if (await fileExists(full)) return full;
    throw new Error(`Entry override not found: ${explicit}`);
  }

  const pkgPath = path.join(cwd, 'package.json');
  if (await fileExists(pkgPath)) {
    const pkg = await readJSON<{ main?: string }>(pkgPath);
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

export { fsp }; // re-export if needed in other modules
