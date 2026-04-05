// file: libs/sdk/src/skill/resources/skill-example-content.resource.ts

import { ReadResourceResult } from '@frontmcp/protocol';
import { ResourceContext, ResourceCompletionResult } from '../../common/interfaces';
import { ResourceTemplate } from '../../common';
import { ResourceNotFoundError } from '../../errors';
import {
  findAndLoadSkill,
  getMcpVisibleSkillNames,
  readAndParseSkillFile,
  collectAllExampleNames,
} from './skill-resource.helpers';

type Params = { skillName: string; exampleName: string };

/**
 * Resource template for reading a specific example from a skill.
 *
 * URI: `skills://{skillName}/examples/{exampleName}`
 *
 * Returns the example markdown content with frontmatter stripped.
 */
@ResourceTemplate({
  name: 'skill-example-content',
  uriTemplate: 'skills://{skillName}/examples/{exampleName}',
  description:
    'Read the full content of a specific worked example from a skill. ' +
    'Returns the example markdown with complexity level and parent reference info.',
  mimeType: 'text/markdown',
})
export class SkillExampleContentResource extends ResourceContext<Params> {
  async skillNameCompleter(partial: string): Promise<ResourceCompletionResult> {
    const names = getMcpVisibleSkillNames(this.scope, partial);
    return { values: names, total: names.length };
  }

  async exampleNameCompleter(partial: string): Promise<ResourceCompletionResult> {
    const names = await collectAllExampleNames(this.scope, partial);
    return { values: names, total: names.length };
  }

  async execute(uri: string, params: Params): Promise<ReadResourceResult> {
    const { loadResult, instance } = await findAndLoadSkill(this.scope, params.skillName);
    const examples = loadResult.skill.resolvedExamples ?? [];

    const exEntry = examples.find((e) => e.name === params.exampleName);
    if (!exEntry) {
      throw new ResourceNotFoundError(uri);
    }

    const { body } = await readAndParseSkillFile(instance, 'examples', exEntry.filename);

    return {
      contents: [
        {
          uri,
          mimeType: 'text/markdown',
          text: body,
        },
      ],
    };
  }
}
