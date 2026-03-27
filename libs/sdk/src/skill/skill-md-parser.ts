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
import type {
  SkillMetadata,
  SkillResources,
  SkillToolRef,
  SkillParameter,
  SkillExample,
} from '../common/metadata/skill.metadata';

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

  // Tools — string names or detailed refs from YAML
  if (Array.isArray(frontmatter['tools'])) {
    result.tools = frontmatter['tools']
      .map((t: unknown): string | SkillToolRef | undefined => {
        if (typeof t === 'string') return t;
        if (
          typeof t === 'object' &&
          t !== null &&
          'name' in t &&
          typeof (t as Record<string, unknown>)['name'] === 'string'
        ) {
          const ref: SkillToolRef = { name: (t as Record<string, unknown>)['name'] as string };
          if (typeof (t as Record<string, unknown>)['purpose'] === 'string')
            ref.purpose = (t as Record<string, unknown>)['purpose'] as string;
          if (typeof (t as Record<string, unknown>)['required'] === 'boolean')
            ref.required = (t as Record<string, unknown>)['required'] as boolean;
          return ref;
        }
        return undefined;
      })
      .filter((t): t is string | SkillToolRef => t !== undefined);
  }

  // Parameters
  if (Array.isArray(frontmatter['parameters'])) {
    result.parameters = frontmatter['parameters']
      .filter((p: unknown): p is Record<string, unknown> => typeof p === 'object' && p !== null && 'name' in p)
      .map((p: Record<string, unknown>): SkillParameter => {
        const param: SkillParameter = { name: String(p['name']) };
        if (typeof p['description'] === 'string') param.description = p['description'];
        if (typeof p['required'] === 'boolean') param.required = p['required'];
        if (typeof p['type'] === 'string') param.type = p['type'] as SkillParameter['type'];
        if (p['default'] !== undefined) param.default = p['default'];
        return param;
      });
  }

  // Examples
  if (Array.isArray(frontmatter['examples'])) {
    result.examples = frontmatter['examples']
      .filter((e: unknown): e is Record<string, unknown> => typeof e === 'object' && e !== null && 'scenario' in e)
      .map((e: Record<string, unknown>): SkillExample => {
        const example: SkillExample = { scenario: String(e['scenario']) };
        if (typeof e['parameters'] === 'object' && e['parameters'] !== null) {
          example.parameters = e['parameters'] as Record<string, unknown>;
        }
        if (typeof e['expectedOutcome'] === 'string') example.expectedOutcome = e['expectedOutcome'];
        if (typeof e['expected-outcome'] === 'string') example.expectedOutcome = e['expected-outcome'];
        return example;
      });
  }

  // Priority
  if (typeof frontmatter['priority'] === 'number') {
    result.priority = frontmatter['priority'];
  }

  // Visibility
  const vis = frontmatter['visibility'];
  if (vis === 'mcp' || vis === 'http' || vis === 'both') {
    result.visibility = vis;
  }

  // hideFromDiscovery (supports kebab-case from YAML)
  const hide = frontmatter['hideFromDiscovery'] ?? frontmatter['hide-from-discovery'];
  if (typeof hide === 'boolean') {
    result.hideFromDiscovery = hide;
  }

  // toolValidation (supports kebab-case from YAML)
  const tv = frontmatter['toolValidation'] ?? frontmatter['tool-validation'];
  if (tv === 'strict' || tv === 'warn' || tv === 'ignore') {
    result.toolValidation = tv;
  }

  // Pass unknown fields through to specMetadata (preserves provider-specific fields like user-invocable)
  const knownKeys = new Set([
    'name',
    'description',
    'license',
    'compatibility',
    'metadata',
    'allowed-tools',
    'tags',
    'tools',
    'parameters',
    'examples',
    'priority',
    'visibility',
    'hideFromDiscovery',
    'hide-from-discovery',
    'toolValidation',
    'tool-validation',
  ]);
  for (const [key, val] of Object.entries(frontmatter)) {
    if (!knownKeys.has(key) && val !== undefined) {
      if (!result.specMetadata) result.specMetadata = {};
      result.specMetadata[key] = typeof val === 'string' ? val : JSON.stringify(val);
    }
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
