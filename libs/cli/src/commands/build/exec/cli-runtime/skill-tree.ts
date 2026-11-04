/**
 * The skills an install writes into a folder it manages, kept as two kinds: the server's own `@Skill`s ("shipped"),
 * from the metadata the build recorded, and the skills of its Skilled OpenAPI bundle, read from the running server.
 * A record of each kind's folders and of every file written lets a reinstall, or a refresh of the bundle skills alone,
 * remove only what an install wrote. Shared by the Claude plugin and the Codex skills folder.
 */

import * as path from 'path';

import { cp, ensureDir, fileExists, readdir, rm, writeFile } from '@frontmcp/utils';

import type { PluginEmitterBundleSkillInput, PluginEmitterSkillInput } from './plugin-emitter';
import { composeSkillMd, readSkillInstructions } from './skill-md-compose';

const MAX_FOLDER_LENGTH = 64;

/** What an install records about the skills it wrote. */
export interface SkillTreeRecord {
  /** The folder of each skill, of both kinds. */
  skills: string[];
  /** The bundle skills among them, and the bundle version they were read from. */
  bundleSkills?: InstalledBundleSkills;
  /** The files and folders written, relative to the tree's root. */
  managedFiles: string[];
}

export interface InstalledBundleSkills {
  bundleVersion?: string;
  skills: string[];
}

export interface SkillTreeLayout {
  /** The folder `managedFiles` are relative to. */
  root: string;
  /** Where the skill folders go: `<root>/skills` in a Claude plugin, the root itself for Codex. */
  skillsDir: string;
}

export interface PlannedFile {
  absPath: string;
  relPath: string;
  write: () => Promise<void>;
}

export interface SkillPlan {
  files: PlannedFile[];
  /** The folder of each shipped skill, which is its name. */
  shippedSkills: string[];
  bundleSkills: Array<{ name: string; folder: string }>;
  /** Shipped skills left out because they had no instructions to install. */
  skillsSkipped: Array<{ name: string; reason: string }>;
}

export interface BundleRefreshResult {
  bundleVersion?: string;
  /** Bundle skill folders written for the first time. */
  added: string[];
  /** Bundle skill folders written again. */
  updated: string[];
  /** Bundle skill folders of skills the bundle no longer has, or the caller may no longer use. */
  removed: string[];
  filesWritten: string[];
  filesRemoved: string[];
}

/** A skill's folder name: its name in kebab-case, at most 64 characters, or `skill` when no letter or digit is left. */
export function skillFolderName(name: string): string {
  const kebab = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_FOLDER_LENGTH)
    .replace(/^-+|-+$/g, '');
  return kebab || 'skill';
}

/** Each skill's folder: {@link skillFolderName}, with `-2`, `-3` and on when a reserved folder or an earlier skill has it. */
export function assignSkillFolders(names: string[], reserved: Iterable<string>): string[] {
  const taken = new Set(reserved);
  return names.map((name) => {
    const base = skillFolderName(name);
    let folder = base;
    for (let suffix = 2; taken.has(folder); suffix++) {
      folder = `${base.slice(0, MAX_FOLDER_LENGTH - String(suffix).length - 1).replace(/-+$/, '')}-${suffix}`;
    }
    taken.add(folder);
    return folder;
  });
}

/**
 * Plan the SKILL.md and resource folders of the shipped skills, then of the bundle skills, whose folders take no
 * name a shipped skill or `reservedFolders` holds.
 *
 * @param validateName - Throws for a shipped skill name that is not a safe folder name
 */
export async function planSkills(
  layout: SkillTreeLayout,
  shipped: PluginEmitterSkillInput[],
  bundle: PluginEmitterBundleSkillInput[] | undefined,
  validateName: (name: string) => void,
  reservedFolders: string[] = [],
): Promise<SkillPlan> {
  const plan: SkillPlan = { files: [], shippedSkills: [], bundleSkills: [], skillsSkipped: [] };
  for (const skill of [...shipped].sort((a, b) => a.name.localeCompare(b.name))) {
    validateName(skill.name);
    const instructions = await readSkillInstructions(skill);
    if ('skipReason' in instructions) {
      plan.skillsSkipped.push({ name: skill.name, reason: instructions.skipReason });
      continue;
    }
    plan.shippedSkills.push(skill.name);
    const skillDir = path.join(layout.skillsDir, skill.name);
    const skillMd = composeSkillMd(
      { name: skill.name, description: skill.description, tags: skill.tags, license: skill.license },
      instructions.body,
    );
    plan.files.push(plannedWrite(layout, path.join(skillDir, 'SKILL.md'), skillMd));
    for (const kind of ['references', 'examples', 'scripts', 'assets'] as const) {
      const source = skill.resourceDirs?.[kind];
      if (!source) continue;
      const dest = path.join(skillDir, kind);
      plan.files.push({
        absPath: dest,
        relPath: path.relative(layout.root, dest),
        write: async () => {
          await ensureDir(skillDir);
          if (await fileExists(source)) await cp(source, dest, { recursive: true });
        },
      });
    }
  }
  const bundleSkills = [...(bundle ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  const folders = assignSkillFolders(
    bundleSkills.map((skill) => skill.name),
    [...reservedFolders, ...plan.shippedSkills],
  );
  bundleSkills.forEach((skill, position) => {
    plan.bundleSkills.push({ name: skill.name, folder: folders[position] });
    plan.files.push(plannedWrite(layout, path.join(layout.skillsDir, folders[position], 'SKILL.md'), skill.skillMd));
  });
  return plan;
}

/**
 * Remove what a previous install wrote that this one doesn't, with the skill folders that leaves empty, then write
 * the planned files. Paths that leave the tree's root are never removed.
 */
export async function applyPlan(
  layout: SkillTreeLayout,
  previouslyManaged: string[],
  files: PlannedFile[],
): Promise<{ written: string[]; removed: string[] }> {
  const planned = new Set(files.map((file) => file.relPath));
  const removed: string[] = [];
  for (const relPath of previouslyManaged) {
    if (planned.has(relPath) || !isPluginContainedPath(layout.root, relPath)) continue;
    const absPath = path.join(layout.root, relPath);
    if (!(await fileExists(absPath))) continue;
    await rm(absPath, { recursive: true, force: true });
    removed.push(absPath);
    await removeEmptySkillFolders(layout, path.dirname(absPath));
  }
  const written: string[] = [];
  for (const file of files) {
    await file.write();
    written.push(file.absPath);
  }
  return { written, removed };
}

/**
 * Write the bundle skills again, and remove those no longer given, leaving the shipped skills and every other file
 * of the tree as they are. The bundle skills' folders take no name a shipped skill holds.
 */
export async function refreshBundleSkills(
  layout: SkillTreeLayout,
  record: SkillTreeRecord,
  bundle: { bundleVersion?: string; skills: PluginEmitterBundleSkillInput[] },
  dryRun: boolean,
): Promise<{ record: SkillTreeRecord; result: BundleRefreshResult }> {
  const previousFolders = (record.bundleSkills?.skills ?? []).filter((folder) => folder === skillFolderName(folder));
  const shippedFolders = record.skills.filter((folder) => !previousFolders.includes(folder));
  const plan = await planSkills(layout, [], bundle.skills, () => undefined, shippedFolders);
  const folders = plan.bundleSkills.map((skill) => skill.folder);
  const previousBundleFolderPaths = previousFolders.map((folder) => path.relative(layout.root, path.join(layout.skillsDir, folder)));
  const isPreviousBundleFile = (relPath: string) =>
    previousBundleFolderPaths.some((folderPath) => relPath === folderPath || relPath.startsWith(folderPath + path.sep));
  const previousBundleFiles = record.managedFiles.filter(isPreviousBundleFile);
  const nextRecord: SkillTreeRecord = {
    skills: [...shippedFolders, ...folders].sort(),
    bundleSkills: { ...(bundle.bundleVersion !== undefined && { bundleVersion: bundle.bundleVersion }), skills: folders },
    managedFiles: [
      ...record.managedFiles.filter((relPath) => !isPreviousBundleFile(relPath)),
      ...plan.files.map((file) => file.relPath),
    ].sort(),
  };
  const applied = dryRun
    ? { written: plan.files.map((file) => file.absPath), removed: [] }
    : await applyPlan(layout, previousBundleFiles, plan.files);
  return {
    record: nextRecord,
    result: {
      bundleVersion: bundle.bundleVersion,
      added: folders.filter((folder) => !previousFolders.includes(folder)),
      updated: folders.filter((folder) => previousFolders.includes(folder)),
      removed: previousFolders.filter((folder) => !folders.includes(folder)),
      filesWritten: applied.written,
      filesRemoved: applied.removed,
    },
  };
}

/** The skills by kind, one line each: a bundle skill's name follows its folder when they differ. */
export function describeSkills(
  shipped: string[],
  bundle: { bundleVersion?: string; skills: Array<{ folder: string; name?: string }> } | undefined,
): string[] {
  const lines = [`shipped skills: ${shipped.length > 0 ? shipped.join(', ') : 'none'}`];
  if (bundle) {
    const version = bundle.bundleVersion ? ` (bundle ${bundle.bundleVersion})` : '';
    const skills = bundle.skills.map(({ folder, name }) => (name && name !== folder ? `${folder} (${name})` : folder));
    lines.push(`bundle skills${version}: ${skills.length > 0 ? skills.join(', ') : 'none'}`);
  }
  return lines;
}

/** {@link describeSkills} for the skills an install recorded, for `install --status`. */
export function describeSkillRecord(record: SkillTreeRecord): string[] {
  const bundleFolders = record.bundleSkills?.skills ?? [];
  const shipped = record.skills.filter((folder) => !bundleFolders.includes(folder));
  const bundle = record.bundleSkills && {
    bundleVersion: record.bundleSkills.bundleVersion,
    skills: bundleFolders.map((folder) => ({ folder })),
  };
  return describeSkills(shipped, bundle);
}

/** What a refresh changed, as `1 added (refunds), 1 updated (invoices), 1 removed (admin)`. */
export function describeBundleRefresh(result: BundleRefreshResult): string {
  const counted = (folders: string[], verb: string) =>
    `${folders.length} ${verb}${folders.length > 0 ? ` (${folders.join(', ')})` : ''}`;
  return [counted(result.added, 'added'), counted(result.updated, 'updated'), counted(result.removed, 'removed')].join(', ');
}

/**
 * True when `relPath` resolves to a path strictly inside `root`. Guards removals against a tampered record whose
 * `managedFiles` entries try to escape the root with `../` or absolute paths.
 */
export function isPluginContainedPath(root: string, relPath: string): boolean {
  if (typeof relPath !== 'string' || relPath.length === 0) return false;
  if (path.isAbsolute(relPath)) return false;
  const relative = path.relative(root, path.resolve(root, relPath));
  if (relative === '') return false;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** Remove `dir` when it is empty. Returns whether it was removed. */
export async function removeIfEmpty(dir: string): Promise<boolean> {
  if (!(await fileExists(dir))) return false;
  const entries = await readdir(dir).catch(() => ['unreadable']);
  if (entries.length > 0) return false;
  await rm(dir, { recursive: true, force: true });
  return true;
}

function plannedWrite(layout: SkillTreeLayout, absPath: string, content: string): PlannedFile {
  return {
    absPath,
    relPath: path.relative(layout.root, absPath),
    write: async () => {
      await ensureDir(path.dirname(absPath));
      await writeFile(absPath, content);
    },
  };
}

async function removeEmptySkillFolders(layout: SkillTreeLayout, startDir: string): Promise<void> {
  let dir = startDir;
  while (isPluginContainedPath(layout.skillsDir, path.relative(layout.skillsDir, dir)) && (await removeIfEmpty(dir))) {
    dir = path.dirname(dir);
  }
}
