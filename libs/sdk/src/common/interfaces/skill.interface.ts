// file: libs/sdk/src/common/interfaces/skill.interface.ts

import { Type } from '@frontmcp/di';
import { SkillMetadata, SkillToolRef, normalizeToolRef, SkillParameter, SkillResources } from '../metadata';
import { ExecutionContextBase, ExecutionContextBaseArgs } from './execution-context.interface';
import { SkillRecord } from '../records';

/**
 * Type for skill definitions that can be passed to FrontMcp apps/plugins.
 */
export type SkillType<T = unknown> = Type<T> | SkillRecord;

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
