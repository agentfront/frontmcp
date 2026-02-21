// file: libs/sdk/src/skill/skill-directory-loader.ts

/**
 * Skill directory loader.
 *
 * Loads a complete skill directory containing SKILL.md and optional
 * scripts/, references/, assets/ subdirectories per the Agent Skills spec.
 *
 * @module skill/skill-directory-loader
 */

import { readFile, fileExists, stat } from '@frontmcp/utils';
import { SkillKind } from '../common/records/skill.record';
import type { SkillFileRecord } from '../common/records/skill.record';
import type { SkillMetadata, SkillResources } from '../common/metadata/skill.metadata';
import { skillMetadataSchema } from '../common/metadata/skill.metadata';
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

  const checks = await Promise.all([
    checkDirectory(`${dirPath}/scripts`),
    checkDirectory(`${dirPath}/references`),
    checkDirectory(`${dirPath}/assets`),
    fileExists(`${dirPath}/SKILL.md`),
  ]);

  if (checks[0]) resources.scripts = `${dirPath}/scripts`;
  if (checks[1]) resources.references = `${dirPath}/references`;
  if (checks[2]) resources.assets = `${dirPath}/assets`;

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
  } catch {
    return false;
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
  const skillMdPath = `${dirPath}/SKILL.md`;

  // Verify SKILL.md exists
  const exists = await fileExists(skillMdPath);
  if (!exists) {
    throw new Error(`SKILL.md not found in directory: ${dirPath}`);
  }

  // Read and parse SKILL.md
  const content = await readFile(skillMdPath, 'utf-8');
  const { frontmatter, body } = parseSkillMdFrontmatter(content);
  const partialMetadata = skillMdFrontmatterToMetadata(frontmatter, body);

  // Scan for resource directories
  const { resources } = await scanSkillResources(dirPath);
  const hasResources = resources.scripts || resources.references || resources.assets;
  if (hasResources) {
    partialMetadata.resources = resources;
  }

  // Validate name matches directory name (per spec recommendation)
  const dirName = dirPath.split('/').filter(Boolean).pop();
  if (partialMetadata.name && dirName && partialMetadata.name !== dirName) {
    // Warn but don't fail — directory name mismatch is not fatal
  }

  // Ensure required fields
  if (!partialMetadata.name) {
    throw new Error(`SKILL.md in ${dirPath} is missing required 'name' field in frontmatter.`);
  }
  if (!partialMetadata.description) {
    throw new Error(`SKILL.md in ${dirPath} is missing required 'description' field in frontmatter.`);
  }
  if (!partialMetadata.instructions) {
    throw new Error(`SKILL.md in ${dirPath} has no body content for instructions.`);
  }

  const metadata = partialMetadata as SkillMetadata;

  // Validate against schema
  const parsed = skillMetadataSchema.safeParse(metadata);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid skill metadata in ${dirPath}: ${issues}`);
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
