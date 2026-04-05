// file: libs/sdk/src/skill/resources/skill-content.resource.ts

import { ReadResourceResult } from '@frontmcp/protocol';
import { ResourceContext, ResourceCompletionResult } from '../../common/interfaces';
import { ResourceTemplate } from '../../common';
import { findAndLoadSkill, getMcpVisibleSkillNames } from './skill-resource.helpers';
import { formatSkillForLLM } from '../skill.utils';

type SkillNameParams = { skillName: string };

/**
 * Resource template for loading a skill's full content.
 *
 * URI: `skills://{skillName}`
 *
 * Returns the SKILL.md content formatted for LLM consumption,
 * including tool schemas, routing tables for references/examples,
 * and availability information.
 */
@ResourceTemplate({
  name: 'skill-content',
  uriTemplate: 'skills://{skillName}',
  description:
    'Load the full content of a skill by name. ' +
    'Returns formatted SKILL.md with instructions, tool schemas, ' +
    'and routing tables for references and examples.',
  mimeType: 'text/markdown',
})
export class SkillContentResource extends ResourceContext<SkillNameParams> {
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
