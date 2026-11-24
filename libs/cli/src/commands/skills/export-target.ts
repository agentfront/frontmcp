// file: libs/cli/src/commands/skills/export-target.ts
//
// Where `frontmcp skills export` may write. A rule file, or a folder above it, may be a link, as long as it leads
// inside the project: the git repository holding the output folder, or that folder outside a repository.

import * as path from 'path';

import { chmod, fileExists, lstat, mkdir, randomUUID, realpath, rename, rm, stat, writeFile } from '@frontmcp/utils';

/** A write refused because the path leads outside the project. */
export class ExportTargetRefusal extends Error {}

/** True for `parent` itself and any path inside it. */
export function isWithin(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/**
 * The project an export writes into, with its links resolved: the git repository holding `outDir`, else `outDir`. A
 * folder that is itself a link is not taken for a checkout, and a checkout reached through a link that sits inside an
 * outer checkout gives way to that outer one: such a link redirects output out of the project. A link with no
 * checkout above it (an alias such as macOS's `/var`) is followed.
 */
export async function exportRoot(outDir: string): Promise<string> {
  const ancestors = [path.resolve(outDir)];
  for (let dir = ancestors[0]; path.dirname(dir) !== dir; dir = path.dirname(dir)) {
    ancestors.push(path.dirname(dir));
  }
  const links = await Promise.all(ancestors.map(isLink));
  let searchFrom = 0;
  for (;;) {
    const checkout = await nearestCheckout(ancestors, links, searchFrom);
    if (checkout === undefined) return resolveLinks(ancestors[0]);
    const linkAbove = links.indexOf(true, checkout + 1);
    if (linkAbove === -1 || (await nearestCheckout(ancestors, links, linkAbove + 1)) === undefined) {
      return resolveLinks(ancestors[checkout]);
    }
    searchFrom = linkAbove + 1;
  }
}

/** The index of the nearest of `ancestors`, from `searchFrom` up, that holds a `.git` and is not itself a link. */
async function nearestCheckout(
  ancestors: readonly string[],
  links: readonly boolean[],
  searchFrom: number,
): Promise<number | undefined> {
  for (let index = searchFrom; index < ancestors.length; index++) {
    if (!links[index] && (await fileExists(path.join(ancestors[index], '.git')))) return index;
  }
  return undefined;
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
 * Write `contents` to `target` through a new file renamed into place, so no link made after the check is followed. The
 * writes run inside the verified folder, entered level by level and checked, so its path isn't followed again. A file
 * it replaces keeps its permissions.
 */
export async function writeExportTarget(target: string, contents: string): Promise<void> {
  const name = path.basename(target);
  const previousDirectory = process.cwd();
  try {
    await enterVerifiedDirectory(path.dirname(target));
    const temporary = `.${name}.${randomUUID()}.tmp`;
    const mode = await stat(name).then(
      (stats) => stats.mode & 0o7777,
      () => undefined,
    );
    await writeFile(temporary, contents, { flag: 'wx', mode });
    try {
      if (mode !== undefined) await chmod(temporary, mode);
      await rename(temporary, name);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  } finally {
    process.chdir(previousDirectory);
  }
}

/**
 * Enter `directory`, a resolved path: its deepest existing folder first, then each missing level, created inside the
 * folder entered before it. Each is checked to be where its path says, so no level is reached through a link swapped
 * in after the check, and no folder is created through one.
 */
async function enterVerifiedDirectory(directory: string): Promise<void> {
  const missing: string[] = [];
  let existing = directory;
  while (!(await fileExists(existing)) && path.dirname(existing) !== existing) {
    missing.unshift(path.basename(existing));
    existing = path.dirname(existing);
  }
  await enterAndVerify(existing, existing);
  let expected = existing;
  for (const level of missing) {
    expected = path.join(expected, level);
    await mkdir(level).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    await enterAndVerify(level, expected);
  }
}

/** `process.chdir(next)`, refused when the folder entered, resolved through its links and junctions, isn't `expected`. */
async function enterAndVerify(next: string, expected: string): Promise<void> {
  process.chdir(next);
  const entered = await realpath('.');
  if (entered !== expected) {
    throw new ExportTargetRefusal(`${expected} now leads to ${entered}, so it was not written to`);
  }
}
