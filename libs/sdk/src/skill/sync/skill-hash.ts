// file: libs/sdk/src/skill/sync/skill-hash.ts

import { sha256Hex } from '@frontmcp/utils';
import type { SkillContent } from '../../common/interfaces';

/**
 * Components of a skill hash, useful for debugging and partial updates.
 */
export interface SkillHashComponents {
  /**
   * SHA-256 hash of the instructions only.
   */
  instructionsHash: string;

  /**
   * SHA-256 hash of the tools array (sorted by name).
   */
  toolsHash: string;

  /**
   * SHA-256 hash of metadata (id, name, description).
   */
  metadataHash: string;

  /**
   * Combined hash of all components.
   */
  combinedHash: string;
}

/**
 * Deterministically serialize skill content for hashing.
 * Ensures consistent hash output regardless of property order.
 */
function serializeForHash(skill: SkillContent): string {
  // Sort tools by name for deterministic ordering
  const sortedTools = [...skill.tools].sort((a, b) => a.name.localeCompare(b.name));

  // Sort parameters by name if present
  const sortedParameters = skill.parameters
    ? [...skill.parameters].sort((a, b) => a.name.localeCompare(b.name))
    : undefined;

  // Sort examples by scenario if present
  const sortedExamples = skill.examples
    ? [...skill.examples].sort((a, b) => a.scenario.localeCompare(b.scenario))
    : undefined;

  const content = {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    instructions: skill.instructions,
    tools: sortedTools,
    parameters: sortedParameters,
    examples: sortedExamples,
  };

  return JSON.stringify(content);
}

/**
 * Compute a deterministic SHA-256 hash of a skill's content.
 * Used for change detection during sync operations.
 *
 * @param skill - The skill content to hash
 * @returns Hexadecimal SHA-256 hash string
 *
 * @example
 * ```typescript
 * const hash1 = computeSkillHash(skill);
 * // ... modify skill ...
 * const hash2 = computeSkillHash(skill);
 * if (hash1 !== hash2) {
 *   // Skill content changed, need to sync
 * }
 * ```
 */
export function computeSkillHash(skill: SkillContent): string {
  const serialized = serializeForHash(skill);
  return sha256Hex(serialized);
}

/**
 * Compute detailed hash components for a skill.
 * Useful for understanding what changed between versions.
 *
 * @param skill - The skill content to hash
 * @returns Individual hash components and combined hash
 *
 * @example
 * ```typescript
 * const components = computeSkillHashComponents(skill);
 * if (components.instructionsHash !== prevComponents.instructionsHash) {
 *   console.log('Instructions changed');
 * }
 * ```
 */
export function computeSkillHashComponents(skill: SkillContent): SkillHashComponents {
  // Hash individual components
  const instructionsHash = sha256Hex(skill.instructions);

  const sortedTools = [...skill.tools].sort((a, b) => a.name.localeCompare(b.name));
  const toolsHash = sha256Hex(JSON.stringify(sortedTools));

  const metadata = { id: skill.id, name: skill.name, description: skill.description };
  const metadataHash = sha256Hex(JSON.stringify(metadata));

  // Combine hashes in a deterministic order
  const combinedHash = sha256Hex([instructionsHash, toolsHash, metadataHash].join(':'));

  return {
    instructionsHash,
    toolsHash,
    metadataHash,
    combinedHash,
  };
}

/**
 * Compare two skills for content equality using their hashes.
 *
 * @param skill1 - First skill
 * @param skill2 - Second skill
 * @returns True if skills have identical content
 */
export function areSkillsEqual(skill1: SkillContent, skill2: SkillContent): boolean {
  return computeSkillHash(skill1) === computeSkillHash(skill2);
}
