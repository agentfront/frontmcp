import { z } from 'zod';
import { Type, isClass, getMetadata } from '@frontmcp/di';
import { isValidMcpUri } from '@frontmcp/utils';
import { RawZodShape } from '../types';
import { FrontMcpToolTokens } from '../tokens';
import type { ToolContext } from '../interfaces';

// ============================================
// Skill Metadata Types
// ============================================

declare global {
  /**
   * Declarative metadata extends to the Skill decorator.
   */
  interface ExtendFrontMcpSkillMetadata {}
}

/**
 * Reference to a tool used by a skill.
 * Can be a simple string (tool name), a tool class, or a detailed reference with purpose.
 */
export interface SkillToolRef {
  /**
   * The name of the tool being referenced.
   */
  name: string;

  /**
   * Optional description of why/how this tool is used in the skill.
   * Helps LLMs understand the tool's role in the workflow.
   */
  purpose?: string;

  /**
   * Whether this tool is required for the skill to function.
   * If true and the tool is missing, skill execution may fail.
   * Default: false
   */
  required?: boolean;
}

/**
 * Input type for tool references in skill metadata.
 * Supports:
 * - Tool class (recommended): Automatically extracts tool name from decorated class
 * - String: Tool name directly (useful for dynamic/external tools)
 * - SkillToolRef: Detailed reference with purpose and required flag
 */
export type SkillToolInput = string | Type<ToolContext> | SkillToolRef | SkillToolRefWithClass;

/**
 * Detailed tool reference that includes a class for automatic name extraction.
 */
export interface SkillToolRefWithClass {
  /**
   * The tool class decorated with @Tool.
   * The tool name will be extracted automatically.
   */
  tool: Type<ToolContext>;

  /**
   * Optional description of why/how this tool is used in the skill.
   */
  purpose?: string;

  /**
   * Whether this tool is required for the skill to function.
   */
  required?: boolean;
}

/**
 * Parameter definition for a skill.
 * Parameters are inputs that customize skill behavior.
 */
export interface SkillParameter {
  /**
   * Parameter name (identifier).
   */
  name: string;

  /**
   * Human-readable description of the parameter.
   */
  description?: string;

  /**
   * Whether this parameter is required.
   * Default: false
   */
  required?: boolean;

  /**
   * Type hint for the parameter value.
   * Default: 'string'
   */
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array';

  /**
   * Default value for the parameter.
   */
  default?: unknown;
}

/**
 * Example usage scenario for a skill.
 * Helps LLMs understand when and how to use the skill.
 */
export interface SkillExample {
  /**
   * Description of the scenario where this skill applies.
   */
  scenario: string;

  /**
   * Optional parameter values for this example.
   */
  parameters?: Record<string, unknown>;

  /**
   * Description of the expected outcome when the skill completes.
   */
  expectedOutcome?: string;
}

/**
 * Instruction source for a skill.
 * Instructions can be provided inline, from a file, or from a URL.
 */
export type SkillInstructionSource =
  | string // Inline instructions
  | { file: string } // File path to instructions
  | { url: string }; // URL to fetch instructions

/**
 * Declarative metadata describing what a Skill provides.
 * Skills are modular knowledge/workflow packages that teach AI how to perform multi-step tasks.
 */
export interface SkillMetadata extends ExtendFrontMcpSkillMetadata {
  /**
   * Optional unique identifier for the skill.
   * If omitted, the name will be used as the identifier.
   */
  id?: string;

  /**
   * Unique name for the skill.
   * Used for discovery and invocation.
   */
  name: string;

  /**
   * Short description of what the skill does.
   * Used in search results and discovery.
   */
  description: string;

  /**
   * Detailed instructions for performing the skill.
   * Can be an inline string, file path, or URL.
   *
   * @example Inline instructions
   * ```typescript
   * instructions: 'Step 1: Review the PR...\nStep 2: Check for issues...'
   * ```
   *
   * @example File-based instructions
   * ```typescript
   * instructions: { file: './skills/review-pr.md' }
   * ```
   *
   * @example URL-based instructions
   * ```typescript
   * instructions: { url: 'https://example.com/skills/review-pr.md' }
   * ```
   */
  instructions: SkillInstructionSource;

  /**
   * Tools that this skill uses or depends on.
   * Can be tool classes (recommended), tool names, or detailed references.
   *
   * @example Using tool classes (recommended)
   * ```typescript
   * tools: [GitHubGetPRTool, GitHubAddCommentTool]
   * ```
   *
   * @example Using tool classes with purpose
   * ```typescript
   * tools: [
   *   { tool: GitHubGetPRTool, purpose: 'Fetch PR details', required: true },
   *   { tool: GitHubAddCommentTool, purpose: 'Add review comments' },
   * ]
   * ```
   *
   * @example Using string names (for dynamic/external tools)
   * ```typescript
   * tools: ['github_create_pr', 'github_add_comment']
   * ```
   *
   * @example Mixed references
   * ```typescript
   * tools: [
   *   GitHubGetPRTool,  // Class - name auto-extracted
   *   { tool: GitHubAddCommentTool, purpose: 'Add comments' },
   *   'external_api_tool',  // String - for dynamic tools
   *   { name: 'legacy_tool', purpose: 'Legacy integration', required: true },
   * ]
   * ```
   */
  tools?: SkillToolInput[];

  /**
   * Tags for categorization and discovery.
   * Used to filter and search for skills.
   */
  tags?: string[];

  /**
   * Input parameters that customize skill behavior.
   */
  parameters?: SkillParameter[];

  /**
   * Usage examples demonstrating when to use this skill.
   */
  examples?: SkillExample[];

  /**
   * Priority weight for search ranking.
   * Higher values appear earlier in search results.
   * Default: 0
   */
  priority?: number;

  /**
   * If true, the skill will not be shown in discovery/search results.
   * Can still be loaded directly by ID/name.
   * Use case: internal skills not meant for general discovery.
   * Default: false
   */
  hideFromDiscovery?: boolean;

  /**
   * Validation mode for tool references.
   * Controls what happens when the skill references tools that are missing or hidden.
   *
   * - 'strict': Fail initialization if any referenced tools are missing/hidden
   * - 'warn': Log warnings but continue initialization (default)
   * - 'ignore': Skip tool validation entirely
   *
   * @default 'warn'
   *
   * @example Strict validation (fail on missing tools)
   * ```typescript
   * @Skill({
   *   name: 'review-pr',
   *   tools: ['github_get_pr', 'github_add_comment'],
   *   toolValidation: 'strict',  // Fail if tools missing
   * })
   * class ReviewPRSkill {}
   * ```
   */
  toolValidation?: 'strict' | 'warn' | 'ignore';
}

// ============================================
// Zod Schemas for Validation
// ============================================

const skillToolRefSchema = z.object({
  name: z.string().min(1),
  purpose: z.string().optional(),
  required: z.boolean().optional().default(false),
});

const skillToolRefWithClassSchema = z.object({
  tool: z.function(), // Tool class
  purpose: z.string().optional(),
  required: z.boolean().optional().default(false),
});

// Accepts: string, tool class (function), SkillToolRef, or SkillToolRefWithClass
const skillToolInputSchema = z.union([
  z.string().min(1), // String tool name
  z.function(), // Tool class (will be validated at runtime)
  skillToolRefSchema, // { name, purpose?, required? }
  skillToolRefWithClassSchema, // { tool, purpose?, required? }
]);

const skillParameterSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean().optional().default(false),
  type: z.enum(['string', 'number', 'boolean', 'object', 'array']).optional().default('string'),
  default: z.unknown().optional(),
});

const skillExampleSchema = z.object({
  scenario: z.string().min(1),
  parameters: z.record(z.string(), z.unknown()).optional(),
  expectedOutcome: z.string().optional(),
});

const skillInstructionSourceSchema = z.union([
  z.string().min(1), // Inline instructions
  z.object({ file: z.string().min(1) }).strict(), // File path
  z
    .object({
      url: z.string().refine(isValidMcpUri, {
        message: 'URL must have a valid scheme (e.g., https://, file://, custom://)',
      }),
    })
    .strict(), // URL
]);

/**
 * Validation mode for skill tool references.
 */
export type SkillToolValidationMode = 'strict' | 'warn' | 'ignore';

/**
 * Zod schema for validating SkillMetadata.
 */
export const skillMetadataSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1),
    description: z.string().min(1),
    instructions: skillInstructionSourceSchema,
    tools: z.array(skillToolInputSchema).optional(),
    tags: z.array(z.string().min(1)).optional(),
    parameters: z.array(skillParameterSchema).optional(),
    examples: z.array(skillExampleSchema).optional(),
    priority: z.number().optional().default(0),
    hideFromDiscovery: z.boolean().optional().default(false),
    toolValidation: z.enum(['strict', 'warn', 'ignore']).optional().default('warn'),
  } satisfies RawZodShape<SkillMetadata, ExtendFrontMcpSkillMetadata>)
  .passthrough();

/**
 * Type-safe parsed SkillMetadata from Zod schema.
 */
export type ParsedSkillMetadata = z.output<typeof skillMetadataSchema>;

// ============================================
// Helper Functions
// ============================================

/**
 * Check if a value is a SkillToolRefWithClass (has 'tool' property with a class).
 */
export function isToolRefWithClass(ref: unknown): ref is SkillToolRefWithClass {
  return (
    typeof ref === 'object' &&
    ref !== null &&
    'tool' in ref &&
    typeof (ref as SkillToolRefWithClass).tool === 'function'
  );
}

/**
 * Check if a value is a standard SkillToolRef (has 'name' property).
 */
export function isToolRefWithName(ref: unknown): ref is SkillToolRef {
  return typeof ref === 'object' && ref !== null && 'name' in ref && typeof (ref as SkillToolRef).name === 'string';
}

/**
 * Extract tool name from a tool class decorated with @Tool.
 * Returns undefined if the class is not a valid tool or lacks a name.
 */
export function getToolNameFromClass(toolClass: Type<ToolContext>): string | undefined {
  if (!isClass(toolClass)) return undefined;

  // Try to get the tool name from metadata
  const toolName = getMetadata(FrontMcpToolTokens.name, toolClass);
  if (typeof toolName === 'string') return toolName;

  return undefined;
}

/**
 * Normalize a tool reference to the full SkillToolRef format.
 * Supports: string, tool class, SkillToolRef, or SkillToolRefWithClass.
 *
 * @param ref - The tool reference to normalize
 * @returns Normalized SkillToolRef with name, purpose, and required flag
 * @throws Error if tool class doesn't have a valid name
 */
export function normalizeToolRef(ref: SkillToolInput): SkillToolRef {
  // String tool name
  if (typeof ref === 'string') {
    return { name: ref, required: false };
  }

  // Tool class (function)
  if (typeof ref === 'function') {
    const name = getToolNameFromClass(ref as Type<ToolContext>);
    if (!name) {
      // Note: Using plain Error to avoid circular dependency with errors module
      throw new Error(
        `Invalid tool class '${ref.name ?? 'unknown'}'. ` +
          'Tool class must be decorated with @Tool and have a name property.',
      );
    }
    return { name, required: false };
  }

  // SkillToolRefWithClass: { tool: ToolClass, purpose?, required? }
  if (isToolRefWithClass(ref)) {
    const name = getToolNameFromClass(ref.tool);
    if (!name) {
      // Note: Using plain Error to avoid circular dependency with errors module
      throw new Error(
        `Invalid tool class in reference. ` + 'Tool class must be decorated with @Tool and have a name property.',
      );
    }
    return {
      name,
      purpose: ref.purpose,
      required: ref.required ?? false,
    };
  }

  // Standard SkillToolRef: { name, purpose?, required? }
  if (isToolRefWithName(ref)) {
    return { ...ref, required: ref.required ?? false };
  }

  // Note: Using plain Error to avoid circular dependency with errors module
  throw new Error(`Invalid tool reference: ${JSON.stringify(ref)}`);
}

/**
 * Extract tool names from skill metadata.
 * Handles all supported tool reference formats.
 */
export function extractToolNames(metadata: SkillMetadata): string[] {
  if (!metadata.tools) return [];

  return metadata.tools.map((t) => {
    // String name
    if (typeof t === 'string') return t;

    // Tool class
    if (typeof t === 'function') {
      const name = getToolNameFromClass(t as Type<ToolContext>);
      return name ?? `unknown:${t.name}`;
    }

    // SkillToolRefWithClass
    if (isToolRefWithClass(t)) {
      const name = getToolNameFromClass(t.tool);
      return name ?? `unknown:${t.tool.name}`;
    }

    // Standard SkillToolRef
    return (t as SkillToolRef).name;
  });
}

/**
 * Check if instruction source is inline string.
 */
export function isInlineInstructions(source: SkillInstructionSource): source is string {
  return typeof source === 'string';
}

/**
 * Check if instruction source is a file path.
 */
export function isFileInstructions(source: SkillInstructionSource): source is { file: string } {
  return typeof source === 'object' && 'file' in source;
}

/**
 * Check if instruction source is a URL.
 */
export function isUrlInstructions(source: SkillInstructionSource): source is { url: string } {
  return typeof source === 'object' && 'url' in source;
}
