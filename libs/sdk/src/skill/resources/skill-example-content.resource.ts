// file: libs/sdk/src/skill/resources/skill-example-content.resource.ts

import { type ReadResourceResult } from '@frontmcp/protocol';

import { ResourceTemplate } from '../../common';
import { ResourceContext, type ResourceCompletionResult } from '../../common/interfaces';
import { ResourceNotFoundError } from '../../errors';
import {
  collectAllExampleNames,
  findAndLoadSkill,
  getMcpVisibleSkillNames,
  loadResolvedSkillResourceBody,
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
    'Returns the example markdown body with frontmatter stripped.',
  mimeType: 'text/markdown',
})
export class SkillExampleContentResource extends ResourceContext<Params> {
  async skillNameCompleter(partial: string): Promise<ResourceCompletionResult> {
    const names = getMcpVisibleSkillNames(this.scope, partial);
    return { values: names, total: names.length };
  }

  // Note: MCP completion/complete doesn't provide other template parameter values,
  // so this completer returns examples from ALL skills, not scoped to skillName.
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

    const body = await loadResolvedSkillResourceBody(instance, 'examples', exEntry);

    return {
      contents: [
        {
          uri,
          mimeType: exEntry.mediaType ?? 'text/markdown',
          text: body,
        },
      ],
    };
  }
}
