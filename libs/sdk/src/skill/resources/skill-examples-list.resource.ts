// file: libs/sdk/src/skill/resources/skill-examples-list.resource.ts

import { ReadResourceResult } from '@frontmcp/protocol';
import { ResourceContext, ResourceCompletionResult } from '../../common/interfaces';
import { ResourceTemplate } from '../../common';
import { findAndLoadSkill, getMcpVisibleSkillNames } from './skill-resource.helpers';

type SkillNameParams = { skillName: string };

/**
 * Resource template listing all examples for a skill.
 *
 * URI: `skills://{skillName}/examples`
 *
 * Returns a JSON array of example metadata (name, description, reference, level).
 * Use `skills://{skillName}/examples/{exampleName}` to read the content.
 */
@ResourceTemplate({
  name: 'skill-examples-list',
  uriTemplate: 'skills://{skillName}/examples',
  description:
    'List all worked examples available for a skill. ' +
    'Returns example names, descriptions, and complexity levels. ' +
    'Use skills://{skillName}/examples/{exampleName} to read content.',
  mimeType: 'application/json',
})
export class SkillExamplesListResource extends ResourceContext<SkillNameParams> {
  async skillNameCompleter(partial: string): Promise<ResourceCompletionResult> {
    const names = getMcpVisibleSkillNames(this.scope, partial);
    return { values: names, total: names.length };
  }

  async execute(uri: string, params: SkillNameParams): Promise<ReadResourceResult> {
    const { loadResult } = await findAndLoadSkill(this.scope, params.skillName);
    const examples = loadResult.skill.resolvedExamples ?? [];

    const listing = examples.map((ex) => ({
      name: ex.name,
      description: ex.description,
      reference: ex.reference,
      level: ex.level,
      uri: `skills://${params.skillName}/examples/${encodeURIComponent(ex.name)}`,
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
