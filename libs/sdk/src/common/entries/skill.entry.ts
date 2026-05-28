// file: libs/sdk/src/common/entries/skill.entry.ts

import { type SkillContent, type SkillContext } from '../interfaces';
import {
  normalizeToolRef,
  type SkillMetadata,
  type SkillReferencedOperation,
  type SkillResources,
  type SkillToolRef,
} from '../metadata';
import { type SkillRecord } from '../records';
import { BaseEntry, type EntryOwnerRef } from './base.entry';

/**
 * Result of loading a skill with tool validation information.
 */
export type SkillLoadResult = {
  /**
   * The loaded skill content.
   */
  skill: SkillContent;

  /**
   * Tools that are available in the current scope.
   */
  availableTools: string[];

  /**
   * Tools that are referenced but not available.
   */
  missingTools: string[];

  /**
   * True if all required tools are available.
   */
  isComplete: boolean;

  /**
   * Warning message if tools are missing.
   */
  warning?: string;
};

/**
 * Result returned from skill validation.
 */
export type SafeSkillLoadResult<T> = { success: true; data: T } | { success: false; error: Error };

/**
 * Abstract base class for skill entries.
 *
 * Skills are knowledge/workflow packages that don't execute directly.
 * Instead, they provide instructions and context for LLMs to perform tasks.
 */
export abstract class SkillEntry extends BaseEntry<SkillRecord, SkillContext, SkillMetadata> {
  /**
   * The owner of this skill (app, plugin, etc.).
   */
  owner: EntryOwnerRef;

  /**
   * The name of the skill, as declared in the metadata.
   */
  name: string;

  /**
   * The full qualified name of the skill, including the owner name as prefix.
   */
  fullName: string;

  /**
   * Get a short description of the skill.
   */
  abstract getDescription(): string;

  /**
   * Load the skill's detailed instructions.
   * Resolves from inline string, file path, or URL based on metadata.
   */
  abstract loadInstructions(): Promise<string>;

  /**
   * Load the full skill content.
   * Returns the complete skill with resolved instructions.
   */
  abstract load(): Promise<SkillContent>;

  /**
   * Get the tool references from the skill metadata.
   * Returns normalized SkillToolRef objects.
   */
  getToolRefs(): SkillToolRef[] {
    const tools = this.metadata.tools;
    if (!tools) return [];
    return tools.map((t) => normalizeToolRef(t));
  }

  /**
   * Get tool names from the skill metadata.
   */
  getToolNames(): string[] {
    return this.getToolRefs().map((t) => t.name);
  }

  /**
   * Get the skill's tags for categorization.
   */
  getTags(): string[] {
    return this.metadata.tags ?? [];
  }

  /**
   * Check if the skill should be hidden from discovery.
   */
  isHidden(): boolean {
    return this.metadata.hideFromDiscovery === true;
  }

  /**
   * Check if this skill is always loaded — bindings derived from this skill
   * are merged into every codecall:execute call regardless of the skills the
   * agent passed. See SkillMetadata.alwaysLoad for guidance on when to set this.
   */
  isAlwaysLoaded(): boolean {
    return this.metadata.alwaysLoad === true;
  }

  /**
   * Get the OpenAPI operations this skill references in its markdown. Empty
   * array for skills that haven't been through the harvester or that
   * declare capabilities only via decorator `tools`.
   */
  getReferencedOperations(): SkillReferencedOperation[] {
    return this.metadata.referencedOperations ?? [];
  }

  /**
   * Whether this skill is "executable" — has at least one declared tool
   * OR at least one referenced openapi operation. Skills with neither are
   * pure-knowledge: discoverable via searchKnowledge, callable via execute()
   * but with no tool bindings (the agentscript can only do pure computation).
   */
  isExecutable(): boolean {
    const hasTools = (this.metadata.tools?.length ?? 0) > 0;
    const hasOps = (this.metadata.referencedOperations?.length ?? 0) > 0;
    return hasTools || hasOps;
  }

  /** Convenience inverse of {@link isExecutable}. */
  isKnowledgeOnly(): boolean {
    return !this.isExecutable();
  }

  /**
   * Get the skill's priority for search ranking.
   */
  getPriority(): number {
    return this.metadata.priority ?? 0;
  }

  /**
   * Get the skill's license.
   */
  getLicense(): string | undefined {
    return this.metadata.license;
  }

  /**
   * Get the skill's compatibility notes.
   */
  getCompatibility(): string | undefined {
    return this.metadata.compatibility;
  }

  /**
   * Get the skill's spec metadata (arbitrary key-value pairs).
   */
  getSpecMetadata(): Record<string, string> | undefined {
    return this.metadata.specMetadata;
  }

  /**
   * Get the skill's allowed tools (space-delimited string).
   */
  getAllowedTools(): string | undefined {
    return this.metadata.allowedTools;
  }

  /**
   * Get the skill's bundled resource directories.
   */
  getResources(): SkillResources | undefined {
    return this.metadata.resources;
  }

  /**
   * Get the skill's effective `<skill-path>` segments per SEP-2640.
   *
   * Returns `metadata.skillPath` when set, otherwise `[name]`. The final
   * segment is always equal to `name` (enforced by the metadata schema).
   */
  getSkillPathSegments(): string[] {
    return this.metadata.skillPath && this.metadata.skillPath.length > 0
      ? [...this.metadata.skillPath]
      : [this.metadata.name];
  }

  /**
   * Get the skill's `<skill-path>` joined by `/` for URI construction.
   */
  getSkillPath(): string {
    return this.getSkillPathSegments().join('/');
  }
}
