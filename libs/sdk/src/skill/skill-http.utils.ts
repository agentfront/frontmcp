// file: libs/sdk/src/skill/skill-http.utils.ts

/**
 * Utilities for formatting skills for HTTP endpoints.
 *
 * These utilities provide formatted output for:
 * - /llm.txt - Compact skill summaries
 * - /llm_full.txt - Full skills with instructions and tool schemas
 * - /skills API - JSON responses
 */

import type { SkillContent, SkillEntry, ToolRegistryInterface, ToolEntry } from '../common';
import type { SkillVisibility } from '../common/metadata/skill.metadata';
import type { SkillRegistryInterface as SkillRegistryInterfaceType } from './skill.registry';

/**
 * Compact skill summary for /llm.txt endpoint.
 */
export interface CompactSkillSummary {
  name: string;
  description: string;
  tools?: string[];
  tags?: string[];
}

/**
 * Format skills for compact /llm.txt output.
 * Returns a plain text format suitable for LLM consumption.
 *
 * @param skills - Array of skill entries to format
 * @returns Formatted plain text string
 *
 * @example Output format
 * ```
 * # review-pr
 * Review a GitHub pull request
 * Tools: github_get_pr, github_add_comment
 * Tags: github, code-review
 *
 * ---
 *
 * # deploy-app
 * Deploy application to production
 * Tools: docker_build, k8s_apply
 * Tags: deployment, kubernetes
 * ```
 */
export function formatSkillsForLlmCompact(skills: SkillEntry[]): string {
  const parts: string[] = [];

  for (const skill of skills) {
    const lines: string[] = [];

    // Header with name
    lines.push(`# ${skill.name}`);

    // Description
    lines.push(skill.metadata.description);

    // Tools (if any)
    const toolNames = skill.getToolNames();
    if (toolNames.length > 0) {
      lines.push(`Tools: ${toolNames.join(', ')}`);
    }

    // Tags (if any)
    const tags = skill.metadata.tags;
    if (tags && tags.length > 0) {
      lines.push(`Tags: ${tags.join(', ')}`);
    }

    parts.push(lines.join('\n'));
  }

  return parts.join('\n\n---\n\n');
}

/**
 * Format skills with full instructions AND tool schemas for /llm_full.txt.
 * Loads full skill content and includes complete tool schemas.
 *
 * @param registry - Skill registry to load skills from
 * @param toolRegistry - Tool registry to get tool schemas
 * @param visibility - Optional visibility filter ('http' or 'both')
 * @returns Formatted plain text with full skill details
 */
export async function formatSkillsForLlmFull(
  registry: SkillRegistryInterfaceType,
  toolRegistry: ToolRegistryInterface,
  visibility: SkillVisibility = 'both',
): Promise<string> {
  const skills = registry.getSkills(false); // Don't include hidden
  const parts: string[] = [];

  for (const skill of skills) {
    // Filter by visibility
    const skillVis = skill.metadata.visibility ?? 'both';
    if (visibility !== 'both') {
      if (visibility === 'http' && skillVis === 'mcp') continue;
      if (visibility === 'mcp' && skillVis === 'http') continue;
    }

    const loaded = await registry.loadSkill(skill.name);
    if (loaded) {
      parts.push(formatSkillForLLMWithSchemas(loaded.skill, loaded.availableTools, loaded.missingTools, toolRegistry));
    }
  }

  return parts.join('\n\n---\n\n');
}

/**
 * Format a skill with FULL tool schemas (input/output) - not just names.
 * Used by /llm_full.txt and enhanced loadSkill response.
 *
 * @param skill - The loaded skill content
 * @param availableTools - List of available tool names
 * @param missingTools - List of missing tool names
 * @param toolRegistry - Tool registry for schema lookup
 * @returns Formatted markdown string
 */
export function formatSkillForLLMWithSchemas(
  skill: SkillContent,
  availableTools: string[],
  missingTools: string[],
  toolRegistry: ToolRegistryInterface,
): string {
  const parts: string[] = [];

  // Header
  parts.push(`# Skill: ${skill.name}`);
  parts.push('');
  parts.push(skill.description);
  parts.push('');

  // Warning if tools are missing
  if (missingTools.length > 0) {
    parts.push('> **Warning:** Some tools are not available:');
    parts.push(`> Missing: ${missingTools.join(', ')}`);
    parts.push('');
  }

  // Tools section WITH FULL SCHEMAS
  if (skill.tools.length > 0) {
    parts.push('## Tools');
    parts.push('');

    for (const tool of skill.tools) {
      const isAvailable = availableTools.includes(tool.name);
      const status = isAvailable ? '✓' : '✗';
      parts.push(`### [${status}] ${tool.name}`);

      if (tool.purpose) {
        parts.push(`**Purpose:** ${tool.purpose}`);
      }

      // Include full schema if tool is available
      if (isAvailable) {
        const toolEntry = toolRegistry.getTools(true).find((t) => t.name === tool.name);
        if (toolEntry) {
          const inputSchema = getToolInputSchema(toolEntry);
          const outputSchema = toolEntry.getRawOutputSchema?.() ?? toolEntry.rawOutputSchema;

          if (inputSchema) {
            parts.push('');
            parts.push('**Input Schema:**');
            parts.push('```json');
            parts.push(JSON.stringify(inputSchema, null, 2));
            parts.push('```');
          }

          if (outputSchema) {
            parts.push('');
            parts.push('**Output Schema:**');
            parts.push('```json');
            parts.push(JSON.stringify(outputSchema, null, 2));
            parts.push('```');
          }
        }
      }
      parts.push('');
    }
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

/**
 * Get the input schema for a tool as JSON Schema.
 * Delegates to ToolEntry.getInputJsonSchema() for single source of truth.
 *
 * @param tool - The tool entry
 * @returns JSON Schema object or null if no schema is available
 */
function getToolInputSchema(tool: ToolEntry): Record<string, unknown> | null {
  return tool.getInputJsonSchema();
}

/**
 * Skill API response structure.
 */
export interface SkillApiResponse {
  id: string;
  name: string;
  description: string;
  tags: string[];
  tools: string[];
  parameters?: Array<{
    name: string;
    description?: string;
    required: boolean;
    type: string;
  }>;
  priority: number;
  visibility: SkillVisibility;
  availableTools?: string[];
  missingTools?: string[];
  isComplete?: boolean;
}

/**
 * Convert a skill entry to a JSON-serializable summary.
 * Used by the /skills API endpoint.
 *
 * @param skill - The skill entry
 * @param loadResult - Optional load result with tool availability info
 * @returns JSON-serializable object
 */
export function skillToApiResponse(
  skill: SkillEntry,
  loadResult?: {
    availableTools: string[];
    missingTools: string[];
    isComplete: boolean;
  },
): SkillApiResponse {
  const result: SkillApiResponse = {
    id: skill.metadata.id ?? skill.metadata.name,
    name: skill.metadata.name,
    description: skill.metadata.description,
    tags: skill.metadata.tags ?? [],
    tools: skill.getToolNames(),
    parameters: skill.metadata.parameters?.map((p) => ({
      name: p.name,
      description: p.description,
      required: p.required ?? false,
      type: p.type ?? 'string',
    })),
    priority: skill.metadata.priority ?? 0,
    visibility: skill.metadata.visibility ?? 'both',
  };

  if (loadResult) {
    result.availableTools = loadResult.availableTools;
    result.missingTools = loadResult.missingTools;
    result.isComplete = loadResult.isComplete;
  }

  return result;
}

/**
 * Filter skills by visibility for a given context.
 *
 * @param skills - Array of skill entries
 * @param context - The context requesting skills ('mcp' or 'http')
 * @returns Filtered array of skills visible in the given context
 */
export function filterSkillsByVisibility(skills: SkillEntry[], context: 'mcp' | 'http'): SkillEntry[] {
  return skills.filter((skill) => {
    const visibility = skill.metadata.visibility ?? 'both';
    if (visibility === 'both') return true;
    return visibility === context;
  });
}
