// file: libs/sdk/src/skill/resources/skill-reference-content.resource.ts

import { ReadResourceResult } from '@frontmcp/protocol';
import { ResourceContext, ResourceCompletionResult } from '../../common/interfaces';
import { ResourceTemplate } from '../../common';
import { ResourceNotFoundError } from '../../errors';
import {
  findAndLoadSkill,
  getMcpVisibleSkillNames,
  readAndParseSkillFile,
  collectAllReferenceNames,
} from './skill-resource.helpers';

type Params = { skillName: string; referenceName: string };

/**
 * Resource template for reading a specific reference document from a skill.
 *
 * URI: `skills://{skillName}/references/{referenceName}`
 *
 * Returns the reference markdown content with frontmatter stripped.
 */
@ResourceTemplate({
  name: 'skill-reference-content',
  uriTemplate: 'skills://{skillName}/references/{referenceName}',
  description:
    'Read the full content of a specific reference document from a skill. ' +
    'Returns the reference markdown body with frontmatter stripped.',
  mimeType: 'text/markdown',
})
export class SkillReferenceContentResource extends ResourceContext<Params> {
  async skillNameCompleter(partial: string): Promise<ResourceCompletionResult> {
    const names = getMcpVisibleSkillNames(this.scope, partial);
    return { values: names, total: names.length };
  }

  // Note: MCP completion/complete doesn't provide other template parameter values,
  // so this completer returns references from ALL skills, not scoped to skillName.
  async referenceNameCompleter(partial: string): Promise<ResourceCompletionResult> {
    const names = await collectAllReferenceNames(this.scope, partial);
    return { values: names, total: names.length };
  }

  async execute(uri: string, params: Params): Promise<ReadResourceResult> {
    const { loadResult, instance } = await findAndLoadSkill(this.scope, params.skillName);
    const refs = loadResult.skill.resolvedReferences ?? [];

    const refEntry = refs.find((r) => r.name === params.referenceName);
    if (!refEntry) {
      throw new ResourceNotFoundError(uri);
    }

    const { body } = await readAndParseSkillFile(instance, 'references', refEntry.filename);

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
