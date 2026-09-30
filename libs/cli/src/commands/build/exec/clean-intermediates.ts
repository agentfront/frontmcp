import * as fs from 'fs';
import * as path from 'path';

/**
 * Delete the intermediate files a build left in `outDir`.
 *
 * Only top-level files this build wrote (modified at or after `sinceMs`) are
 * candidates. Files that were already there and untouched — `package.json`,
 * `tsconfig.json`, `frontmcp.config.*` when `outDir` is the project root, or
 * anything kept by `--no-clean` — are left alone.
 *
 * @returns the number of files removed.
 */
export function cleanIntermediateFiles(outDir: string, keep: ReadonlySet<string>, sinceMs: number): number {
  let cleaned = 0;
  for (const file of fs.readdirSync(outDir)) {
    if (keep.has(file) || file.endsWith('.md')) continue;
    const filePath = path.join(outDir, file);
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.mtimeMs < sinceMs) continue;
    fs.unlinkSync(filePath);
    cleaned++;
  }
  return cleaned;
}
