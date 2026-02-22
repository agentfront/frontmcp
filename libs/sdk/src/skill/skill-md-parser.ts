// file: libs/sdk/src/skill/skill-md-parser.ts

/**
 * SKILL.md frontmatter parser.
 *
 * Parses SKILL.md files with YAML frontmatter into SkillMetadata.
 * Follows the Anthropic Agent Skills specification for field mapping.
 *
 * @module skill/skill-md-parser
 */

import * as yaml from 'js-yaml';
import { readFile } from '@frontmcp/utils';
import type { SkillMetadata, SkillResources } from '../common/metadata/skill.metadata';

/**
 * Result of parsing SKILL.md frontmatter.
 */
export interface SkillMdParseResult {
  /** Parsed YAML frontmatter key-value pairs */
  frontmatter: Record<string, unknown>;
  /** Markdown body after the frontmatter */
  body: string;
}

/**
 * Parse YAML frontmatter from a SKILL.md content string.
 *
 * Frontmatter is delimited by `---` at the start of the file:
 * ```
 * ---
 * name: my-skill
 * description: A skill
 * ---
 * # Instructions here
 * ```
 *
 * @param content - Raw SKILL.md file content
 * @returns Parsed frontmatter and body
 */
export function parseSkillMdFrontmatter(content: string): SkillMdParseResult {
  const trimmed = content.trimStart();

  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: content };
  }

  // Find closing delimiter
  const closingIndex = trimmed.indexOf('\n---', 3);
  if (closingIndex === -1) {
    // No closing delimiter found — treat entire content as body
    return { frontmatter: {}, body: content };
  }

  const yamlBlock = trimmed.substring(3, closingIndex).trim();
  const afterClose = closingIndex + 4;
  const bodyStart = trimmed[afterClose] === '\n' ? afterClose + 1 : afterClose;
  const body = trimmed.substring(bodyStart);

  let frontmatter: Record<string, unknown> = {};
  try {
    const parsed: unknown = yaml.load(yamlBlock);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      frontmatter = parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed YAML — return empty frontmatter, full content as body
    return { frontmatter: {}, body: content };
  }

  return { frontmatter, body };
}

/**
 * Map SKILL.md frontmatter fields to SkillMetadata.
 *
 * Handles spec field name differences:
 * - `metadata` -> `specMetadata`
 * - `allowed-tools` -> `allowedTools`
 *
 * The markdown body becomes the `instructions` field.
 *
 * @param frontmatter - Parsed frontmatter key-value pairs
 * @param body - Markdown body (becomes instructions)
 * @returns Partial SkillMetadata populated from frontmatter
 */
export function skillMdFrontmatterToMetadata(
  frontmatter: Record<string, unknown>,
  body: string,
): Partial<SkillMetadata> {
  const result: Partial<SkillMetadata> = {};

  // Direct mappings
  if (typeof frontmatter['name'] === 'string') result.name = frontmatter['name'];
  if (typeof frontmatter['description'] === 'string') result.description = frontmatter['description'];
  if (typeof frontmatter['license'] === 'string') result.license = frontmatter['license'];
  if (typeof frontmatter['compatibility'] === 'string') result.compatibility = frontmatter['compatibility'];

  // Spec `metadata` -> FrontMCP `specMetadata`
  if (typeof frontmatter['metadata'] === 'object' && frontmatter['metadata'] !== null) {
    const meta = frontmatter['metadata'] as Record<string, unknown>;
    const specMeta: Record<string, string> = {};
    for (const [key, val] of Object.entries(meta)) {
      if (typeof val === 'string') specMeta[key] = val;
      else specMeta[key] = JSON.stringify(val);
    }
    result.specMetadata = specMeta;
  }

  // Spec `allowed-tools` -> FrontMCP `allowedTools`
  if (typeof frontmatter['allowed-tools'] === 'string') {
    result.allowedTools = frontmatter['allowed-tools'];
  }

  // Tags
  if (Array.isArray(frontmatter['tags'])) {
    result.tags = frontmatter['tags'].filter((t): t is string => typeof t === 'string');
  }

  // Body becomes instructions
  if (body.length > 0) {
    result.instructions = body;
  }

  return result;
}

/**
 * Load and parse a SKILL.md file into SkillMetadata.
 *
 * Reads the file, parses YAML frontmatter, and maps fields to SkillMetadata.
 * Optionally auto-detects resource directories relative to the file path.
 *
 * @param filePath - Absolute or relative path to the SKILL.md file
 * @param resources - Optional pre-scanned resource directories
 * @returns Partial SkillMetadata populated from the file
 */
export async function loadSkillMdFile(filePath: string, resources?: SkillResources): Promise<Partial<SkillMetadata>> {
  const content = await readFile(filePath, 'utf-8');
  const { frontmatter, body } = parseSkillMdFrontmatter(content);
  const metadata = skillMdFrontmatterToMetadata(frontmatter, body);

  if (resources) {
    metadata.resources = resources;
  }

  return metadata;
}

/**
 * Strip YAML frontmatter from a markdown string.
 * Returns only the body content after the frontmatter.
 *
 * @param content - Raw markdown content potentially with frontmatter
 * @returns Content with frontmatter stripped
 */
export function stripFrontmatter(content: string): string {
  const { body } = parseSkillMdFrontmatter(content);
  return body;
}
