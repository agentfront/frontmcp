// file: libs/sdk/src/skill/skill.utils.ts

import { Token, Type, isClass, getMetadata, depsOfClass } from '@frontmcp/di';
import {
  SkillMetadata,
  SkillKind,
  SkillRecord,
  SkillContext,
  FrontMcpSkillTokens,
  extendedSkillMetadata,
  SkillType,
  isFileInstructions,
  isUrlInstructions,
  isInlineInstructions,
  SkillInstructionSource,
  normalizeToolRef,
} from '../common';
import { SkillContent } from '../common/interfaces';
import { readFile } from '@frontmcp/utils';

/**
 * Collect skill metadata from a decorated class.
 *
 * @param cls - The class to collect metadata from
 * @returns The skill metadata
 */
export function collectSkillMetadata(cls: SkillType): SkillMetadata {
  const extended = getMetadata(extendedSkillMetadata, cls);
  const seed = (extended ? { ...extended } : {}) as SkillMetadata;

  return Object.entries(FrontMcpSkillTokens).reduce((metadata, [key, token]) => {
    const value = getMetadata(token, cls);
    if (value !== undefined) {
      return Object.assign(metadata, { [key]: value });
    }
    return metadata;
  }, seed);
}

/**
 * Normalize any skill input to a SkillRecord.
 *
 * Handles:
 * - Class with @Skill decorator → SkillClassTokenRecord
 * - SkillValueRecord (from skill() helper) → passthrough
 * - SkillFileRecord → passthrough
 *
 * @param item - The skill input to normalize
 * @returns A normalized SkillRecord
 * @throws Error if the input is invalid
 */
export function normalizeSkill(item: unknown): SkillRecord {
  // Check if it's already a SkillRecord (from skill() helper or file loader)
  if (isSkillRecord(item)) {
    return item;
  }

  // Check if it's a class with @Skill decorator
  if (isClass(item)) {
    const metadata = collectSkillMetadata(item as SkillType);
    if (!metadata.name) {
      const className = (item as object).constructor?.name ?? String(item);
      throw new Error(
        `Invalid skill class '${className}'. ` +
          'Class must be decorated with @Skill decorator and have a name property.',
      );
    }
    return {
      kind: SkillKind.CLASS_TOKEN,
      provide: item as Type<SkillContext>,
      metadata,
    };
  }

  // Invalid input
  const name = typeof item === 'object' && item !== null ? (item as Record<string, unknown>)['name'] : String(item);
  throw new Error(
    `Invalid skill '${name ?? 'unknown'}'. ` + 'Expected a class decorated with @Skill or a skill() helper result.',
  );
}

/**
 * Check if an object is a SkillRecord.
 */
export function isSkillRecord(item: unknown): item is SkillRecord {
  if (typeof item !== 'object' || item === null) {
    return false;
  }

  const record = item as Record<string, unknown>;

  // Check for kind property
  if (!record['kind'] || typeof record['kind'] !== 'string') {
    return false;
  }

  // Validate kind is one of the allowed values
  const validKinds = [SkillKind.CLASS_TOKEN, SkillKind.VALUE, SkillKind.FILE];
  if (!validKinds.includes(record['kind'] as SkillKind)) {
    return false;
  }

  // Check for required properties
  if (!record['provide'] || !record['metadata']) {
    return false;
  }

  return true;
}

/**
 * Get dependency tokens from a skill record for DI graph validation.
 *
 * @param rec - The skill record
 * @returns Array of dependency tokens
 */
export function skillDiscoveryDeps(rec: SkillRecord): Token[] {
  switch (rec.kind) {
    case SkillKind.CLASS_TOKEN:
      return depsOfClass(rec.provide, 'discovery');
    case SkillKind.VALUE:
    case SkillKind.FILE:
      // Value and file records don't have class dependencies
      return [];
  }
}

/**
 * Load instructions from a skill instruction source.
 *
 * @param source - The instruction source (inline, file, or URL)
 * @param basePath - Base path for resolving relative file paths
 * @returns The loaded instructions as a string
 */
export async function loadInstructions(source: SkillInstructionSource, basePath?: string): Promise<string> {
  if (isInlineInstructions(source)) {
    return source;
  }

  if (isFileInstructions(source)) {
    // Resolve file path
    const filePath = basePath ? `${basePath}/${source.file}` : source.file;
    return readFile(filePath, 'utf-8');
  }

  if (isUrlInstructions(source)) {
    // Fetch from URL
    const response = await fetch(source.url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch skill instructions from ${source.url}: ${response.status} ${response.statusText}`,
      );
    }
    return response.text();
  }

  throw new Error('Invalid instruction source: must be a string, { file: string }, or { url: string }');
}

/**
 * Build SkillContent from metadata and resolved instructions.
 *
 * @param metadata - The skill metadata
 * @param instructions - The resolved instructions string
 * @returns The full skill content
 */
export function buildSkillContent(metadata: SkillMetadata, instructions: string): SkillContent {
  return {
    id: metadata.id ?? metadata.name,
    name: metadata.name,
    description: metadata.description,
    instructions,
    tools: normalizeToolRefs(metadata.tools),
    parameters: metadata.parameters,
    examples: metadata.examples,
  };
}

/**
 * Normalize tool references to the array format expected by SkillContent.
 * Handles all supported tool reference formats: string, class, SkillToolRef, SkillToolRefWithClass.
 * Preserves the required flag for tool enforcement during skill sessions.
 */
function normalizeToolRefs(tools: SkillMetadata['tools']): SkillContent['tools'] {
  if (!tools) return [];

  return tools.map((tool) => {
    try {
      const normalized = normalizeToolRef(tool);
      return {
        name: normalized.name,
        purpose: normalized.purpose,
        required: normalized.required,
      };
    } catch {
      // Fallback for edge cases
      if (typeof tool === 'string') return { name: tool };
      if (typeof tool === 'function') return { name: tool.name ?? 'unknown' };
      if ('name' in (tool as object)) {
        const obj = tool as { name: string; purpose?: string; required?: boolean };
        return { name: obj.name, purpose: obj.purpose, required: obj.required };
      }
      if ('tool' in (tool as object)) {
        const obj = tool as { tool: { name?: string }; purpose?: string; required?: boolean };
        return { name: obj.tool.name ?? 'unknown', purpose: obj.purpose, required: obj.required };
      }
      return { name: 'unknown' };
    }
  });
}

/**
 * Format a skill for LLM consumption.
 *
 * Creates a markdown-formatted string with the skill instructions,
 * tool information, and any warnings about missing tools.
 *
 * @param skill - The loaded skill content
 * @param availableTools - List of available tools
 * @param missingTools - List of missing tools
 * @returns Formatted skill content as markdown
 */
export function formatSkillForLLM(skill: SkillContent, availableTools: string[], missingTools: string[]): string {
  const parts: string[] = [];

  // Header
  parts.push(`# Skill: ${skill.name}`);
  parts.push('');
  parts.push(skill.description);
  parts.push('');

  // Warning if tools are missing
  if (missingTools.length > 0) {
    parts.push('> **Warning:** Some tools referenced by this skill are not available:');
    parts.push(`> Missing: ${missingTools.join(', ')}`);
    parts.push('> You may need to adapt the workflow or skip steps that require these tools.');
    parts.push('');
  }

  // Tools section
  if (skill.tools.length > 0) {
    parts.push('## Tools');
    parts.push('');
    for (const tool of skill.tools) {
      const status = availableTools.includes(tool.name) ? '✓' : '✗';
      const purpose = tool.purpose ? ` - ${tool.purpose}` : '';
      parts.push(`- [${status}] \`${tool.name}\`${purpose}`);
    }
    parts.push('');
  }

  // Parameters section
  if (skill.parameters && skill.parameters.length > 0) {
    parts.push('## Parameters');
    parts.push('');
    for (const param of skill.parameters) {
      const required = param.required ? ' (required)' : '';
      const desc = param.description ? `: ${param.description}` : '';
      parts.push(`- **${param.name}**${required}${desc}`);
    }
    parts.push('');
  }

  // Instructions
  parts.push('## Instructions');
  parts.push('');
  parts.push(skill.instructions);

  // Examples section
  if (skill.examples && skill.examples.length > 0) {
    parts.push('');
    parts.push('## Examples');
    parts.push('');
    for (const example of skill.examples) {
      parts.push(`### ${example.scenario}`);
      if (example.expectedOutcome) {
        parts.push(`Expected outcome: ${example.expectedOutcome}`);
      }
      parts.push('');
    }
  }

  return parts.join('\n');
}
