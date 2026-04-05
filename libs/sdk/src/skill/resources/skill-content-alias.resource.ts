// file: libs/sdk/src/skill/resources/skill-content-alias.resource.ts

import { ReadResourceResult } from '@frontmcp/protocol';
import { ResourceContext, ResourceCompletionResult } from '../../common/interfaces';
import { ResourceTemplate } from '../../common';
import { findAndLoadSkill, getMcpVisibleSkillNames } from './skill-resource.helpers';
import { formatSkillForLLM } from '../skill.utils';

type SkillNameParams = { skillName: string };

/**
 * Alias resource template for loading a skill's SKILL.md by explicit path.
 *
 * URI: `skills://{skillName}/SKILL.md`
 *
 * Identical to `skills://{skillName}` — provided so that explicit
 * file-path-style access works naturally.
 */
@ResourceTemplate({
  name: 'skill-content-file',
  uriTemplate: 'skills://{skillName}/SKILL.md',
  description:
    'Load the SKILL.md content of a skill by explicit path. ' +
    'Same as skills://{skillName} — provided for file-path-style access.',
  mimeType: 'text/markdown',
})
export class SkillContentAliasResource extends ResourceContext<SkillNameParams> {
  async skillNameCompleter(partial: string): Promise<ResourceCompletionResult> {
    const names = getMcpVisibleSkillNames(this.scope, partial);
    return { values: names, total: names.length };
  }

  async execute(uri: string, params: SkillNameParams): Promise<ReadResourceResult> {
    const { loadResult } = await findAndLoadSkill(this.scope, params.skillName);
    const { skill, availableTools, missingTools } = loadResult;

    const formattedContent = formatSkillForLLM(skill, availableTools, missingTools);

    return {
      contents: [
        {
          uri,
          mimeType: 'text/markdown',
          text: formattedContent,
        },
      ],
    };
  }
}
