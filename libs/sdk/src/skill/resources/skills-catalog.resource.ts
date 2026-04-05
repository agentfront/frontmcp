// file: libs/sdk/src/skill/resources/skills-catalog.resource.ts

import { ReadResourceResult } from '@frontmcp/protocol';
import { ResourceContext } from '../../common/interfaces';
import { Resource } from '../../common';
import { getMcpVisibleSkills } from './skill-resource.helpers';

/**
 * Static resource listing all MCP-visible skills.
 *
 * URI: `skills://catalog`
 *
 * Returns a JSON array of skill summaries including id, name, description,
 * tags, and whether the skill has references/examples.
 */
@Resource({
  name: 'skills-catalog',
  uri: 'skills://catalog',
  description:
    'List all available skills on this server. ' +
    'Returns skill names, descriptions, and tags for discovery. ' +
    'Use the skill name with skills://{skillName} to load full content.',
  mimeType: 'application/json',
})
export class SkillsCatalogResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    const skills = getMcpVisibleSkills(this.scope);

    const catalog = await Promise.all(
      skills.map(async (skill) => {
        const content = await skill.load();
        return {
          id: content.id,
          name: content.name,
          description: content.description,
          tags: skill.getTags(),
          hasReferences: (content.resolvedReferences ?? []).length > 0,
          hasExamples: (content.resolvedExamples ?? []).length > 0,
          tools: content.tools.map((t) => t.name),
        };
      }),
    );

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(catalog, null, 2),
        },
      ],
    };
  }
}
