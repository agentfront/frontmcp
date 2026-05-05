// file: libs/sdk/src/skill/sep-2640/resources/index.ts

/**
 * SEP-2640 (Skills Extension) MCP resources.
 *
 * Three resources:
 *   - `skill://index.json`              — discovery index (Sep2640SkillIndexResource)
 *   - `skill://{+skillPath}/SKILL.md`    — raw SKILL.md       (Sep2640SkillMdResource)
 *   - `skill://{+skillPath}/{+filePath}` — generic sub-files  (Sep2640SkillFileResource)
 *
 * Order matters at registration time: the SKILL.md template MUST be
 * registered before the generic file template so the more-specific match
 * wins.
 */

import { Sep2640SkillFileResource } from './skill-file.resource';
import { Sep2640SkillIndexResource } from './skill-index.resource';
import { Sep2640SkillMdResource } from './skill-md.resource';

export { Sep2640SkillFileResource, Sep2640SkillIndexResource, Sep2640SkillMdResource };

/**
 * Constructor type for SEP-2640 resource classes. The concrete resource
 * classes (`Sep2640SkillIndexResource`, `Sep2640SkillMdResource`,
 * `Sep2640SkillFileResource`) are MCP `Resource` / `ResourceTemplate`
 * subclasses; consumers register them via `registerDynamicResource`.
 */
export type Sep2640ResourceCtor =
  | typeof Sep2640SkillIndexResource
  | typeof Sep2640SkillMdResource
  | typeof Sep2640SkillFileResource;

/**
 * Get all SEP-2640 conformance resources in registration-priority order.
 * The index resource and SKILL.md template come first; the generic file
 * template is last so SKILL.md is matched by its dedicated route.
 */
export function getSep2640Resources(): Sep2640ResourceCtor[] {
  return [Sep2640SkillIndexResource, Sep2640SkillMdResource, Sep2640SkillFileResource];
}
