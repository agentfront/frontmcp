// file: libs/sdk/src/skill/resources/index.ts

/**
 * Skill Resources
 *
 * MCP resources for discovering and reading skills via the `skills://` URI scheme.
 * These resources are automatically registered when skills are available.
 *
 * URI patterns:
 * - `skills://catalog` — list all skills
 * - `skills://{skillName}` — load skill content (SKILL.md)
 * - `skills://{skillName}/SKILL.md` — same (explicit path alias)
 * - `skills://{skillName}/references` — list references
 * - `skills://{skillName}/references/{referenceName}` — read reference
 * - `skills://{skillName}/examples` — list examples
 * - `skills://{skillName}/examples/{exampleName}` — read example
 *
 * @module skill/resources
 */

import { SkillsCatalogResource } from './skills-catalog.resource';
import { SkillContentResource } from './skill-content.resource';
import { SkillContentAliasResource } from './skill-content-alias.resource';
import { SkillReferencesListResource } from './skill-references-list.resource';
import { SkillReferenceContentResource } from './skill-reference-content.resource';
import { SkillExamplesListResource } from './skill-examples-list.resource';
import { SkillExampleContentResource } from './skill-example-content.resource';

export {
  SkillsCatalogResource,
  SkillContentResource,
  SkillContentAliasResource,
  SkillReferencesListResource,
  SkillReferenceContentResource,
  SkillExamplesListResource,
  SkillExampleContentResource,
};

export {
  getMcpVisibleSkills,
  getMcpVisibleSkillNames,
  findAndLoadSkill,
  readSkillFile,
  readAndParseSkillFile,
  collectAllReferenceNames,
  collectAllExampleNames,
} from './skill-resource.helpers';

/**
 * Get all skill-related resources.
 * Used by the SDK to register skill resources when skills are available.
 */
export function getSkillResources(): unknown[] {
  return [
    SkillsCatalogResource,
    SkillContentResource,
    SkillContentAliasResource,
    SkillReferencesListResource,
    SkillReferenceContentResource,
    SkillExamplesListResource,
    SkillExampleContentResource,
  ];
}
