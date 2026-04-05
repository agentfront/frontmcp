// file: libs/sdk/src/skill/resources/skill-references-list.resource.ts

import { ReadResourceResult } from '@frontmcp/protocol';
import { ResourceContext, ResourceCompletionResult } from '../../common/interfaces';
import { ResourceTemplate } from '../../common';
import { findAndLoadSkill, getMcpVisibleSkillNames } from './skill-resource.helpers';

type SkillNameParams = { skillName: string };

/**
 * Resource template listing all references for a skill.
 *
 * URI: `skills://{skillName}/references`
 *
 * Returns a JSON array of reference metadata (name, description, filename).
 * Use `skills://{skillName}/references/{referenceName}` to read the content.
 */
@ResourceTemplate({
  name: 'skill-references-list',
  uriTemplate: 'skills://{skillName}/references',
  description:
    'List all reference documents available for a skill. ' +
    'Returns reference names and descriptions. ' +
    'Use skills://{skillName}/references/{referenceName} to read content.',
  mimeType: 'application/json',
})
export class SkillReferencesListResource extends ResourceContext<SkillNameParams> {
  async skillNameCompleter(partial: string): Promise<ResourceCompletionResult> {
    const names = getMcpVisibleSkillNames(this.scope, partial);
    return { values: names, total: names.length };
  }

  async execute(uri: string, params: SkillNameParams): Promise<ReadResourceResult> {
    const { loadResult } = await findAndLoadSkill(this.scope, params.skillName);
    const refs = loadResult.skill.resolvedReferences ?? [];

    const listing = refs.map((ref) => ({
      name: ref.name,
      description: ref.description,
      uri: `skills://${params.skillName}/references/${encodeURIComponent(ref.name)}`,
    }));

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(listing, null, 2),
        },
      ],
    };
  }
}
