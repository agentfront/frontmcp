// file: libs/sdk/src/skill/skill-directory-loader.ts

/**
 * Skill directory loader.
 *
 * Loads a complete skill directory containing SKILL.md and optional
 * scripts/, references/, assets/ subdirectories per the Agent Skills spec.
 *
 * @module skill/skill-directory-loader
 */

import { basename } from 'node:path';
import { readFile, fileExists, stat, joinPath } from '@frontmcp/utils';
import { SkillKind } from '../common/records/skill.record';
import type { SkillFileRecord } from '../common/records/skill.record';
import type { SkillMetadata, SkillResources } from '../common/metadata/skill.metadata';
import { skillMetadataSchema } from '../common/metadata/skill.metadata';
import { InvalidSkillError } from '../errors/sdk.errors';
import { parseSkillMdFrontmatter, skillMdFrontmatterToMetadata } from './skill-md-parser';

/**
 * Result of scanning a skill directory for resource subdirectories.
 */
export interface ScanResult {
  /** Detected resource directories */
  resources: SkillResources;
  /** Whether SKILL.md exists in the directory */
  hasSkillMd: boolean;
}

/**
 * Scan a directory for Agent Skills spec resource subdirectories.
 *
 * Checks for existence of scripts/, references/, and assets/ directories.
 *
 * @param dirPath - Path to the skill directory
 * @returns Scan result with detected resources
 */
export async function scanSkillResources(dirPath: string): Promise<ScanResult> {
  const resources: SkillResources = {};

  const scriptsPath = joinPath(dirPath, 'scripts');
  const referencesPath = joinPath(dirPath, 'references');
  const assetsPath = joinPath(dirPath, 'assets');

  const checks = await Promise.all([
    checkDirectory(scriptsPath),
    checkDirectory(referencesPath),
    checkDirectory(assetsPath),
    fileExists(joinPath(dirPath, 'SKILL.md')),
  ]);

  if (checks[0]) resources.scripts = scriptsPath;
  if (checks[1]) resources.references = referencesPath;
  if (checks[2]) resources.assets = assetsPath;

  return {
    resources,
    hasSkillMd: checks[3],
  };
}

/**
 * Check if a path exists and is a directory.
 */
async function checkDirectory(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Load a full skill directory into a SkillFileRecord.
 *
 * Reads SKILL.md, parses frontmatter, detects resource directories,
 * and validates the result.
 *
 * @param dirPath - Path to the skill directory
 * @returns A SkillFileRecord ready for registration
 * @throws Error if SKILL.md is not found or metadata is invalid
 */
export async function loadSkillDirectory(dirPath: string): Promise<SkillFileRecord> {
  const skillMdPath = joinPath(dirPath, 'SKILL.md');

  // Verify SKILL.md exists
  const exists = await fileExists(skillMdPath);
  if (!exists) {
    throw new InvalidSkillError(basename(dirPath), 'SKILL.md not found in directory');
  }

  // Read and parse SKILL.md
  let content: string;
  let partialMetadata: Partial<SkillMetadata>;
  try {
    content = await readFile(skillMdPath, 'utf-8');
    const { frontmatter, body } = parseSkillMdFrontmatter(content);
    partialMetadata = skillMdFrontmatterToMetadata(frontmatter, body);
  } catch (err) {
    const name = basename(dirPath);
    const message = err instanceof Error ? err.message : String(err);
    throw new InvalidSkillError(name, `Failed to read or parse SKILL.md: ${message}`);
  }

  // Scan for resource directories
  const { resources } = await scanSkillResources(dirPath);
  const hasResources = resources.scripts || resources.references || resources.assets;
  if (hasResources) {
    partialMetadata.resources = resources;
  }

  // Validate name matches directory name (per spec recommendation)
  const dirName = basename(dirPath);
  if (partialMetadata.name && dirName && partialMetadata.name !== dirName) {
    console.warn(`Skill name "${partialMetadata.name}" does not match directory name "${dirName}"`);
  }

  // Ensure required fields
  if (!partialMetadata.name) {
    throw new InvalidSkillError('unknown', "SKILL.md is missing required 'name' field in frontmatter");
  }
  const skillName = partialMetadata.name;
  if (!partialMetadata.description) {
    throw new InvalidSkillError(skillName, "SKILL.md is missing required 'description' field in frontmatter");
  }
  if (!partialMetadata.instructions) {
    throw new InvalidSkillError(skillName, 'SKILL.md has no body content for instructions');
  }

  const metadata = partialMetadata as SkillMetadata;

  // Validate against schema
  const parsed = skillMetadataSchema.safeParse(metadata);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new InvalidSkillError(partialMetadata.name ?? 'unknown', issues);
  }

  return {
    kind: SkillKind.FILE,
    provide: Symbol(`skill:${metadata.name}`),
    metadata: parsed.data as SkillMetadata,
    filePath: skillMdPath,
  };
}

/**
 * Convenience helper to load a skill directory.
 * Returns a SkillFileRecord suitable for passing to `@FrontMcp({ skills: [...] })`.
 *
 * @param dirPath - Path to the skill directory containing SKILL.md
 * @returns A SkillFileRecord
 *
 * @example
 * ```typescript
 * const mySkill = await skillDir('./skills/review-pr');
 *
 * @FrontMcp({ skills: [mySkill] })
 * class MyApp {}
 * ```
 */
export async function skillDir(dirPath: string): Promise<SkillFileRecord> {
  return loadSkillDirectory(dirPath);
}
