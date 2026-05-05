// file: libs/sdk/src/skill/sep-2640/resources/skill-md.resource.ts

import { type ReadResourceResult } from '@frontmcp/protocol';

import { ResourceTemplate } from '../../../common';
import { ResourceContext, type ResourceCompletionResult } from '../../../common/interfaces';
import { serializeSkillMd } from '../sep-2640.builders';
import { SKILL_MD_MIME_TYPE } from '../sep-2640.constants';
import { findAndLoadSkillByPath, getSepVisibleSkills } from '../sep-2640.resource-helpers';

type Params = { skillPath: string };

/**
 * `skill://{+skillPath}/SKILL.md` — SEP-2640 conformant SKILL.md endpoint.
 *
 * Returns the **raw** SKILL.md content (YAML frontmatter + markdown body)
 * so hosts can parse the result identically to a filesystem-sourced skill,
 * fulfilling the SEP's "Hosts: Unified Treatment" guidance.
 *
 * The `{+skillPath}` template variable matches one or more `/`-separated
 * path segments (RFC 6570 reserved expansion), supporting both flat
 * (`skill://git-workflow/SKILL.md`) and nested
 * (`skill://acme/billing/refunds/SKILL.md`) URI shapes.
 */
@ResourceTemplate({
  name: 'sep2640-skill-md',
  uriTemplate: 'skill://{+skillPath}/SKILL.md',
  description:
    "Read a skill's SKILL.md (raw YAML frontmatter + markdown body) per MCP SEP-2640. " +
    'Conformant clients parse the frontmatter identically to filesystem skills.',
  mimeType: SKILL_MD_MIME_TYPE,
})
export class Sep2640SkillMdResource extends ResourceContext<Params> {
  async skillPathCompleter(partial: string): Promise<ResourceCompletionResult> {
    const skills = getSepVisibleSkills(this.scope);
    const paths = skills.map((s) => s.getSkillPath());
    const filtered = partial ? paths.filter((p) => p.toLowerCase().startsWith(partial.toLowerCase())) : paths;
    return { values: filtered, total: filtered.length };
  }

  async execute(uri: string, params: Params): Promise<ReadResourceResult> {
    const { loadResult } = await findAndLoadSkillByPath(this.scope, params.skillPath);
    const raw = serializeSkillMd(loadResult.skill);

    return {
      contents: [
        {
          uri,
          mimeType: SKILL_MD_MIME_TYPE,
          text: raw,
        },
      ],
    };
  }
}
