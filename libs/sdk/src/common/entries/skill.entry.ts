// file: libs/sdk/src/common/entries/skill.entry.ts

import { BaseEntry, EntryOwnerRef } from './base.entry';
import { SkillRecord } from '../records';
import { SkillContext, SkillContent } from '../interfaces';
import { SkillMetadata, SkillToolRef, SkillResources, normalizeToolRef } from '../metadata';

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
}
