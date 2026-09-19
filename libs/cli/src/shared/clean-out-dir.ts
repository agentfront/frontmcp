// file: libs/cli/src/shared/clean-out-dir.ts
// Wipe a build's output directory before it is written, with guards against
// deleting anything that isn't a build output.

import { realpathSync } from 'fs';
import * as path from 'path';

import { ensureDir, fileExists, rm } from '@frontmcp/utils';

import { c } from '../core/colors';

/** Why a clean was refused, or `undefined` when the directory is safe to wipe. */
export type CleanRefusal = 'is-project-root' | 'contains-project-root' | 'outside-project' | 'filesystem-root';

/**
 * Resolve every symlink on the path that already exists on disk.
 *
 * `path.resolve` is purely lexical, so a `dist` symlink pointing outside the
 * project would still look contained. Walking up to the deepest existing
 * ancestor and calling `realpathSync` there makes the containment check below
 * operate on the location the filesystem would actually delete from.
 */
function resolveThroughSymlinks(target: string): string {
  const resolved = path.resolve(target);
  let existing = resolved;
  const missingSegments: string[] = [];

  for (;;) {
    try {
      return path.join(realpathSync(existing), ...missingSegments.reverse());
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) return resolved;
      missingSegments.push(path.basename(existing));
      existing = parent;
    }
  }
}

/**
 * Decide whether `outDir` may be deleted wholesale.
 *
 * `outDir` reaches the build from `--out-dir` or `deployments[].outDir`, so it
 * is user-controlled and can point anywhere. Recursive deletion is only ever
 * safe for a directory that lives strictly inside the project.
 */
export function checkOutDirSafeToClean(outDir: string, cwd: string): CleanRefusal | undefined {
  const resolvedOut = resolveThroughSymlinks(outDir);
  const resolvedCwd = resolveThroughSymlinks(cwd);

  if (resolvedOut === path.parse(resolvedOut).root) return 'filesystem-root';
  if (resolvedOut === resolvedCwd) return 'is-project-root';

  const fromOutToCwd = path.relative(resolvedOut, resolvedCwd);
  const cwdIsInsideOut = fromOutToCwd !== '' && !fromOutToCwd.startsWith('..') && !path.isAbsolute(fromOutToCwd);
  if (cwdIsInsideOut) return 'contains-project-root';

  const fromCwdToOut = path.relative(resolvedCwd, resolvedOut);
  if (fromCwdToOut.startsWith('..') || path.isAbsolute(fromCwdToOut)) return 'outside-project';

  return undefined;
}

const REFUSAL_REASONS: Record<CleanRefusal, string> = {
  'filesystem-root': 'it is the filesystem root',
  'is-project-root': 'it is the project root',
  'contains-project-root': 'it contains the project root',
  'outside-project': 'it is outside the project',
};

/**
 * Remove everything in `outDir` so the build output reflects only the current
 * source set.
 *
 * Issue #545: `frontmcp build` compiled into `outDir` without clearing it, so
 * `dist/` accumulated the union of every build ever run there. Deleting a
 * source file left its `.js` behind indefinitely, where it could still be
 * pulled into a bundle through a stale import — and it made local builds
 * diverge from CI, which always starts clean.
 *
 * Refuses (with a warning, not an error) for any directory that isn't safely
 * inside the project; the build then proceeds without cleaning, which is the
 * pre-#545 behaviour.
 *
 * @returns true when the directory was cleaned.
 */
export async function cleanOutDir(outDir: string, cwd: string, label = '[build]'): Promise<boolean> {
  const refusal = checkOutDirSafeToClean(outDir, cwd);
  if (refusal) {
    console.log(
      c('yellow', `${label} skipping clean of ${outDir} — ${REFUSAL_REASONS[refusal]}. Pass --no-clean to silence.`),
    );
    return false;
  }

  if (await fileExists(outDir)) {
    await rm(outDir, { recursive: true, force: true });
    console.log(c('gray', `${label} cleaned ${path.relative(cwd, outDir) || outDir}`));
  }
  await ensureDir(outDir);
  return true;
}
