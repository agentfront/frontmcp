// file: libs/sdk/src/skill/resources/skill-resource.helpers.ts

/**
 * Shared helpers for skill resource templates.
 *
 * Extracts reusable logic for loading skills, reading files, and
 * collecting completer values across the `skills://` resource scheme.
 *
 * @module skill/resources/skill-resource.helpers
 */

import { pathResolve, readFile } from '@frontmcp/utils';

import type { ScopeEntry, SkillEntry } from '../../common';
import type { SkillLoadResult } from '../../common/entries/skill.entry';
import { PublicMcpError, ResourceNotFoundError } from '../../errors';
import { parseSkillMdFrontmatter } from '../skill-md-parser';
import type { SkillInstance } from '../skill.instance';

/**
 * Get all MCP-visible skill entries from the scope's skill registry.
 *
 * @param scope - The active scope
 * @returns Array of skill entries with visibility 'mcp' or 'both'
 */
export function getMcpVisibleSkills(scope: ScopeEntry): SkillEntry[] {
  const registry = scope.skills;
  if (!registry || !registry.hasAny()) {
    return [];
  }
  return registry.getSkills({ visibility: 'mcp' });
}

/**
 * Get MCP-visible skill names filtered by an optional partial prefix.
 *
 * @param scope - The active scope
 * @param partial - Optional prefix to filter names by
 * @returns Array of matching skill names
 */
export function getMcpVisibleSkillNames(scope: ScopeEntry, partial?: string): string[] {
  const skills = getMcpVisibleSkills(scope);
  const names = skills.map((s) => s.name);
  if (!partial) {
    return names;
  }
  const lower = partial.toLowerCase();
  return names.filter((n) => n.toLowerCase().startsWith(lower));
}

/**
 * Load a skill by name, verifying MCP visibility.
 *
 * @param scope - The active scope
 * @param skillName - Skill ID or name
 * @returns The load result with skill content, tool availability info
 * @throws Error if skill not found or not MCP-visible
 */
export async function findAndLoadSkill(
  scope: ScopeEntry,
  skillName: string,
): Promise<{ loadResult: SkillLoadResult; instance: SkillInstance }> {
  const registry = scope.skills;
  if (!registry || !registry.hasAny()) {
    throw new PublicMcpError('Skills are not available in this scope.', 'CAPABILITY_NOT_AVAILABLE', 501);
  }

  const entry = registry.findByName(skillName);
  if (!entry) {
    throw new ResourceNotFoundError(`skills://${skillName}`);
  }

  // Verify MCP visibility
  const visibility = entry.metadata.visibility ?? 'both';
  if (visibility !== 'mcp' && visibility !== 'both') {
    throw new PublicMcpError(
      `Skill "${skillName}" is not available via MCP resources (visibility: ${visibility}).`,
      'RESOURCE_NOT_FOUND',
      403,
    );
  }

  const loadResult = await registry.loadSkill(skillName);
  if (!loadResult) {
    throw new PublicMcpError(`Failed to load skill "${skillName}".`, 'INTERNAL_ERROR', 500);
  }

  return { loadResult, instance: entry as SkillInstance };
}

/**
 * Read a reference or example file from a skill's resource directory.
 *
 * @param instance - The skill instance
 * @param resourceType - 'references' or 'examples'
 * @param filename - The filename to read
 * @returns The file content as a string
 * @throws Error if the file cannot be read
 */
export async function readSkillFile(
  instance: SkillInstance,
  resourceType: 'references' | 'examples',
  filename: string,
): Promise<string> {
  const baseDir = instance.getBaseDir();
  const resources = instance.getResources();
  const resourcePath = resources?.[resourceType];

  if (!resourcePath) {
    throw new Error(`Skill does not have a ${resourceType} directory configured.`);
  }

  // Absolute resource paths don't need baseDir; relative paths require it
  if (!resourcePath.startsWith('/') && !baseDir) {
    throw new Error(`Skill does not have a ${resourceType} directory configured.`);
  }

  const resourceDir = resourcePath.startsWith('/') ? resourcePath : pathResolve(baseDir!, resourcePath);
  const filePath = pathResolve(resourceDir, filename);

  // Prevent path traversal — filePath must stay inside resourceDir
  const resourceDirPrefix = resourceDir.endsWith('/') ? resourceDir : `${resourceDir}/`;
  if (filePath !== resourceDir && !filePath.startsWith(resourceDirPrefix)) {
    throw new Error(`Invalid ${resourceType} filename "${filename}".`);
  }

  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    throw new Error(`Failed to read ${resourceType} file "${filename}". The file may have been moved or deleted.`);
  }
}

/**
 * Read a skill file and parse its frontmatter.
 *
 * @param instance - The skill instance
 * @param resourceType - 'references' or 'examples'
 * @param filename - The filename to read
 * @returns Parsed frontmatter and markdown body
 */
export async function readAndParseSkillFile(
  instance: SkillInstance,
  resourceType: 'references' | 'examples',
  filename: string,
): Promise<{ frontmatter: Record<string, unknown>; body: string }> {
  const content = await readSkillFile(instance, resourceType, filename);
  return parseSkillMdFrontmatter(content);
}

/**
 * Resolve a single resolved reference / example entry to its markdown body,
 * honoring the three lookup paths declared on `SkillReferenceInfo` /
 * `SkillExampleInfo`:
 *
 *   1. `content` — return inline (bundle-sourced skills carry the body).
 *   2. `path`    — read from disk on demand (absolute path).
 *   3. `filename` — historical lookup via `instance.getResources()[type]`.
 *
 * Throws when none of the three paths can produce content. Used by the
 * `skills://{skillName}/{references,examples}/{name}` resource handlers so
 * bundle-sourced and catalog-sourced skills surface identically.
 */
export async function loadResolvedSkillResourceBody(
  instance: SkillInstance,
  resourceType: 'references' | 'examples',
  entry: { filename?: string; path?: string; content?: string },
): Promise<string> {
  if (typeof entry.content === 'string') {
    const parsed = parseSkillMdFrontmatter(entry.content);
    return parsed.body || entry.content;
  }
  if (entry.path) {
    try {
      const raw = await readFile(entry.path, 'utf-8');
      const parsed = parseSkillMdFrontmatter(raw);
      return parsed.body || raw;
    } catch {
      throw new Error(`Failed to read ${resourceType} from path "${entry.path}".`);
    }
  }
  if (entry.filename) {
    const { body } = await readAndParseSkillFile(instance, resourceType, entry.filename);
    return body;
  }
  throw new Error(`Resolved ${resourceType} entry has no content/path/filename to load from.`);
}

/**
 * Collect all reference names across all MCP-visible skills, filtered by partial.
 *
 * @param scope - The active scope
 * @param partial - Optional prefix to filter by
 * @returns Array of reference names
 */
export async function collectAllReferenceNames(scope: ScopeEntry, partial?: string): Promise<string[]> {
  const skills = getMcpVisibleSkills(scope);
  const names = new Set<string>();

  for (const skill of skills) {
    try {
      const content = await skill.load();
      const refs = content.resolvedReferences ?? [];
      for (const ref of refs) {
        names.add(ref.name);
      }
    } catch {
      // Skip skills that fail to load
    }
  }

  const sorted = Array.from(names).sort();
  if (!partial) {
    return sorted;
  }
  const lower = partial.toLowerCase();
  return sorted.filter((n) => n.toLowerCase().startsWith(lower));
}

/**
 * Collect all example names across all MCP-visible skills, filtered by partial.
 *
 * @param scope - The active scope
 * @param partial - Optional prefix to filter by
 * @returns Array of example names
 */
export async function collectAllExampleNames(scope: ScopeEntry, partial?: string): Promise<string[]> {
  const skills = getMcpVisibleSkills(scope);
  const names = new Set<string>();

  for (const skill of skills) {
    try {
      const content = await skill.load();
      const examples = content.resolvedExamples ?? [];
      for (const ex of examples) {
        names.add(ex.name);
      }
    } catch {
      // Skip skills that fail to load
    }
  }

  const sorted = Array.from(names).sort();
  if (!partial) {
    return sorted;
  }
  const lower = partial.toLowerCase();
  return sorted.filter((n) => n.toLowerCase().startsWith(lower));
}
