// file: libs/sdk/src/common/interfaces/skill.interface.ts

import { type Type } from '@frontmcp/di';

import {
  normalizeToolRef,
  type SkillMetadata,
  type SkillParameter,
  type SkillResources,
  type SkillToolRef,
} from '../metadata';
import { type SkillRecord } from '../records';
import { ExecutionContextBase, type ExecutionContextBaseArgs } from './execution-context.interface';

/**
 * Type for skill definitions that can be passed to FrontMcp apps/plugins.
 */
export type SkillType<T = unknown> = Type<T> | SkillRecord | string;

/**
 * Metadata for a resolved reference file within a skill's references/ directory.
 *
 * Three lookup paths are supported by the `skills://{skillName}/references/{name}`
 * resource handler — listed in priority order (the first that's set wins):
 *
 *   1. `path`    — read from disk on demand (filesystem-backed catalog skills)
 *   2. `content` — return the bundled inline markdown (bundle-sourced skills)
 *   3. `filename` — historical lookup against the skill's `resources.references`
 *      directory (kept for catalog backwards-compat)
 *
 * Bundle-sourced skills typically populate `name`, `description`, and
 * `content` (no path on disk). Catalog-sourced skills populate `name`,
 * `description`, and `filename` (or absolute `path`) so the file is read
 * lazily on each `resources/read`.
 */
export interface SkillReferenceInfo {
  /** Reference name (typically filename without .md) */
  name: string;
  /** Short description from frontmatter or first paragraph */
  description: string;
  /** Filename relative to the skill directory */
  filename: string;
  /** Optional absolute path on disk for direct lazy read. */
  path?: string;
  /** Optional inline markdown when the bundle carries content directly. */
  content?: string;
  /** Optional MIME type override (default: text/markdown). */
  mediaType?: string;
}

/**
 * Metadata for a resolved example file within a skill's examples/ directory.
 *
 * Same lookup precedence as `SkillReferenceInfo`: `path` → `content` →
 * `filename`.
 */
export interface SkillExampleInfo {
  /** Example name (filename without .md) */
  name: string;
  /** Short description from frontmatter */
  description: string;
  /** Parent reference name (examples are grouped by reference) */
  reference: string;
  /** Complexity level */
  level: string;
  /** Filename relative to the examples directory */
  filename: string;
  /** Optional absolute path on disk for direct lazy read. */
  path?: string;
  /** Optional inline markdown when the bundle carries content directly. */
  content?: string;
  /** Optional MIME type override (default: text/markdown). */
  mediaType?: string;
}

/**
 * Executable action declared by a dynamically-registered skill.
 *
 * Used by skill bundles (e.g. plugin-skilled-openapi) where the skill's content
 * advertises one or more underlying invocable operations whose actual execution
 * is mediated by a plugin-private mechanism. The actions are NOT MCP tools —
 * they are descriptors the LLM reads to know what arguments and outputs to expect
 * when it asks the plugin's meta-tool to execute one.
 */
export interface SkillAction {
  /** Stable identifier within the skill (e.g. an OpenAPI operationId). */
  actionId: string;
  /** One-line summary suitable for inline display to the LLM. */
  summary: string;
  /** Optional human-readable description (markdown allowed). */
  description?: string;
  /** JSON Schema (Draft 2020-12) for the action's input. */
  inputJsonSchema: Record<string, unknown>;
  /** JSON Schema for the action's response payload. */
  outputJsonSchema: Record<string, unknown>;
  /**
   * Optional ABAC/RBAC policy required to invoke this action. Shape is
   * intentionally loose at the SDK boundary so libs/auth can interpret it
   * without forcing the SDK to depend on libs/auth.
   */
  requiredAuthorities?: Record<string, unknown>;
}

/**
 * Full content returned when loading a skill.
 * Contains all information needed for an LLM to execute the skill.
 */
export interface SkillContent {
  /**
   * Unique identifier for the skill (derived from name if not provided).
   */
  id: string;

  /**
   * Human-readable name of the skill.
   */
  name: string;

  /**
   * Short description of what the skill does.
   */
  description: string;

  /**
   * Detailed instructions for performing the skill.
   * Resolved from inline string, file, or URL source.
   */
  instructions: string;

  /**
   * Tools used by this skill, with optional purposes and required flag.
   */
  tools: Array<{ name: string; purpose?: string; required?: boolean }>;

  /**
   * Input parameters that customize skill behavior.
   */
  parameters?: SkillParameter[];

  /**
   * Usage examples demonstrating when to use this skill.
   */
  examples?: Array<{
    scenario: string;
    parameters?: Record<string, unknown>;
    expectedOutcome?: string;
  }>;

  /**
   * License name or reference (per Agent Skills spec).
   */
  license?: string;

  /**
   * Environment requirements or compatibility notes (per Agent Skills spec).
   */
  compatibility?: string;

  /**
   * Arbitrary key-value metadata (maps to spec `metadata` field).
   */
  specMetadata?: Record<string, string>;

  /**
   * Space-delimited pre-approved tools (maps to spec `allowed-tools` field).
   */
  allowedTools?: string;

  /**
   * Bundled resource directories (scripts/, references/, assets/).
   */
  resources?: SkillResources;

  /**
   * Optional skill quality rating (0..5). Mirrors `SkillMetadata.rating` so
   * dynamically registered skills surface the same field in search results.
   */
  rating?: number;

  /**
   * Optional category, used for HTTP API filtering when the skill didn't
   * come from the static catalog tree.
   */
  category?: string;

  /**
   * Resolved reference metadata from the skill's references/ directory.
   * Each entry contains name, description, and filename for the reference.
   */
  resolvedReferences?: SkillReferenceInfo[];

  /**
   * Resolved example metadata from the skill's examples/ directory.
   * Examples are grouped by reference and contain name, description, level, and filename.
   */
  resolvedExamples?: SkillExampleInfo[];

  /**
   * Executable actions exposed by a dynamically-registered skill.
   *
   * Set by skill bundles (e.g. plugin-skilled-openapi) where the skill represents
   * a curated group of invocable operations. The MCP client never sees these as
   * standalone tools; they are surfaced through the skill's content so the LLM
   * knows what it can ask the plugin's meta-tool to invoke.
   */
  actions?: SkillAction[];

  /**
   * Bundle version string for skills sourced from a versioned bundle (e.g. an
   * OpenAPI overlay produced by FrontMCP Cloud). Polling clients can read this
   * from the skill content to detect bundle swaps without relying on
   * `notifications/skills/list_changed`, which is unreliable across MCP clients.
   */
  bundleVersion?: string;
}

/**
 * Constructor arguments for SkillContext.
 */
export type SkillCtorArgs = ExecutionContextBaseArgs & {
  metadata: SkillMetadata;
};

/**
 * Lightweight context class for skills.
 *
 * Unlike ToolContext, SkillContext doesn't have an execute() method because
 * skills don't execute directly - they provide knowledge/instructions that
 * guide LLMs in performing multi-step tasks.
 *
 * This context is primarily used for hooks and lifecycle management.
 */
export abstract class SkillContext extends ExecutionContextBase<SkillContent> {
  protected readonly skillId: string;
  protected readonly skillName: string;
  readonly metadata: SkillMetadata;

  constructor(args: SkillCtorArgs) {
    const { metadata, providers, logger } = args;
    super({
      providers,
      logger: logger.child(`skill:${metadata.id ?? metadata.name}`),
      authInfo: args.authInfo,
    });
    this.skillName = metadata.name;
    this.skillId = metadata.id ?? metadata.name;
    this.metadata = metadata;
  }

  /**
   * Load the skill's detailed instructions.
   * Resolves from inline string, file path, or URL based on metadata.
   */
  abstract loadInstructions(): Promise<string>;

  /**
   * Build the full SkillContent for this skill.
   * Resolves instructions and normalizes all metadata into a single object.
   */
  abstract build(): Promise<SkillContent>;

  /**
   * Get normalized tool references from the skill metadata.
   */
  getToolRefs(): SkillToolRef[] {
    if (!this.metadata.tools) return [];
    return this.metadata.tools.map((t) => normalizeToolRef(t));
  }

  /**
   * Get tool names from the skill metadata.
   */
  getToolNames(): string[] {
    return this.getToolRefs().map((t) => t.name);
  }
}
