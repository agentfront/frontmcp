// file: libs/cli/src/commands/skills/export-target.ts
//
// Where `frontmcp skills export` may write. A rule file, or a folder above it, may be a link, as long as it leads
// inside the project: the git repository holding the output folder, or that folder outside a repository.

import * as path from 'path';

import {
  chmod,
  ensureDir,
  fileExists,
  lstat,
  randomUUID,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from '@frontmcp/utils';

/** A write refused because the path leads outside the project. */
export class ExportTargetRefusal extends Error {}

/** True for `parent` itself and any path inside it. */
export function isWithin(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/**
 * The project an export writes into, with its links resolved: the git repository holding `outDir`, else `outDir`. A
 * `.git` is looked for only where the path to it crosses no link, so a linked output folder can't name the project.
 */
export async function exportRoot(outDir: string): Promise<string> {
  const ancestors = [path.resolve(outDir)];
  for (let dir = ancestors[0]; path.dirname(dir) !== dir; dir = path.dirname(dir)) {
    ancestors.push(path.dirname(dir));
  }
  const linked = await Promise.all(ancestors.map(isLink));
  for (const dir of ancestors.slice(linked.lastIndexOf(true) + 1)) {
    if (await fileExists(path.join(dir, '.git'))) return resolveLinks(dir);
  }
  return resolveLinks(ancestors[0]);
}

function isLink(target: string): Promise<boolean> {
  return lstat(target).then(
    (stats) => stats.isSymbolicLink(),
    () => false,
  );
}

/** `target` with the links on the part of it that exists resolved; the part that doesn't is kept as given. */
async function resolveLinks(target: string): Promise<string> {
  const missing: string[] = [];
  for (let existing = target; ; existing = path.dirname(existing)) {
    try {
      return path.join(await realpath(existing), ...missing);
    } catch {
      if (await isLink(existing)) throw new ExportTargetRefusal(`${existing} is a link to a missing file`);
      if (path.dirname(existing) === existing) return target;
      missing.unshift(path.basename(existing));
    }
  }
}

/** Where writing `file` lands once its links and its folders' are followed; refused when that is outside `root`. */
export async function exportTargetOf(file: string, root: string): Promise<string> {
  const target = await resolveLinks(file);
  if (!isWithin(target, root)) {
    throw new ExportTargetRefusal(`${file} leads through a link to ${target}, outside the project (${root})`);
  }
  return target;
}

/**
 * Write `contents` to `target` through a new file renamed into place, so no link made after the check is followed. A
 * file it replaces keeps its permissions.
 */
export async function writeExportTarget(target: string, contents: string): Promise<void> {
  await ensureDir(path.dirname(target));
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  const mode = await stat(target).then(
    (stats) => stats.mode & 0o7777,
    () => undefined,
  );
  await writeFile(temporary, contents, { flag: 'wx', mode });
  try {
    if (mode !== undefined) await chmod(temporary, mode);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
