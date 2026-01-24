// file: libs/sdk/src/skill/tools/index.ts

/**
 * Skill Tools
 *
 * MCP tools for discovering and loading skills.
 * These tools are automatically registered when skills are available.
 *
 * @module skill/tools
 */

import { SearchSkillsTool } from './search-skills.tool';
import { LoadSkillTool } from './load-skill.tool';

export { SearchSkillsTool, LoadSkillTool };

/**
 * Get all skill-related tools.
 * Used by the SDK to register skill tools when skills are available.
 */
export function getSkillTools() {
  return [SearchSkillsTool, LoadSkillTool];
}
