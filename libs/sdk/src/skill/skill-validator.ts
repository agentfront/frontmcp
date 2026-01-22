// file: libs/sdk/src/skill/skill-validator.ts

import { ToolRegistryInterface } from '../common/interfaces/internal';

/**
 * Result of validating tool availability for a skill.
 */
export interface ToolValidationResult {
  /**
   * Tools that are available (exist and not hidden).
   */
  available: string[];

  /**
   * Tools that don't exist in the registry.
   */
  missing: string[];

  /**
   * Tools that exist but are hidden from discovery.
   */
  hidden: string[];

  /**
   * True if all required tools are available (exist and not hidden).
   */
  complete: boolean;
}

/**
 * Validates tool availability for skills.
 *
 * This validator checks if the tools referenced by a skill are available
 * in the current scope. It categorizes tools as available, missing, or hidden.
 */
export class SkillToolValidator {
  private readonly toolRegistry: ToolRegistryInterface;

  constructor(toolRegistry: ToolRegistryInterface) {
    this.toolRegistry = toolRegistry;
  }

  /**
   * Validate tool availability for a list of tool names.
   *
   * @param toolNames - Array of tool names to validate
   * @param requiredTools - Optional set of tool names that are required
   * @returns Validation result with categorized tools
   */
  validate(toolNames: string[], requiredTools?: Set<string>): ToolValidationResult {
    if (toolNames.length === 0) {
      return {
        available: [],
        missing: [],
        hidden: [],
        complete: true,
      };
    }

    // Get all tools (including hidden)
    const allTools = this.toolRegistry.getTools(true);
    const allToolNames = new Set(allTools.map((t) => t.name));

    // Get visible tools only
    const visibleTools = this.toolRegistry.getTools(false);
    const visibleToolNames = new Set(visibleTools.map((t) => t.name));

    const available: string[] = [];
    const missing: string[] = [];
    const hidden: string[] = [];

    for (const toolName of toolNames) {
      if (visibleToolNames.has(toolName)) {
        available.push(toolName);
      } else if (allToolNames.has(toolName)) {
        hidden.push(toolName);
      } else {
        missing.push(toolName);
      }
    }

    // Check if all required tools are available
    let complete = true;
    if (requiredTools && requiredTools.size > 0) {
      for (const reqTool of requiredTools) {
        if (!visibleToolNames.has(reqTool)) {
          complete = false;
          break;
        }
      }
    } else {
      // If no explicit required tools, consider complete if no missing tools
      complete = missing.length === 0;
    }

    return {
      available,
      missing,
      hidden,
      complete,
    };
  }

  /**
   * Format a warning message for missing/hidden tools.
   *
   * @param result - Validation result
   * @param skillName - Name of the skill (for error message)
   * @returns Warning message or undefined if no issues
   */
  formatWarning(result: ToolValidationResult, skillName: string): string | undefined {
    const issues: string[] = [];

    if (result.missing.length > 0) {
      issues.push(`missing tools: ${result.missing.join(', ')}`);
    }

    if (result.hidden.length > 0) {
      issues.push(`hidden tools: ${result.hidden.join(', ')}`);
    }

    if (issues.length === 0) {
      return undefined;
    }

    return `Skill "${skillName}" references ${issues.join('; ')}. Some functionality may be limited.`;
  }

  /**
   * Check if a single tool is available (exists and not hidden).
   *
   * @param toolName - Name of the tool to check
   * @returns True if the tool is available
   */
  isToolAvailable(toolName: string): boolean {
    const visibleTools = this.toolRegistry.getTools(false);
    return visibleTools.some((t) => t.name === toolName);
  }

  /**
   * Check if a single tool exists (regardless of visibility).
   *
   * @param toolName - Name of the tool to check
   * @returns True if the tool exists
   */
  toolExists(toolName: string): boolean {
    const allTools = this.toolRegistry.getTools(true);
    return allTools.some((t) => t.name === toolName);
  }
}
