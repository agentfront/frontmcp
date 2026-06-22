// file: plugins/plugin-skilled-openapi/src/tools/search-skill.tool.ts

import { ScopeEntry, Tool, ToolContext } from '@frontmcp/sdk';

import { BundleSyncService } from '../sync/bundle-sync.service';
import {
  searchSkillDescription,
  searchSkillInputSchema,
  searchSkillOutputSchema,
  type SearchSkillInput,
  type SearchSkillOutput,
} from './search-skill.schema';

@Tool({
  name: 'search_skill',
  description: searchSkillDescription,
  inputSchema: searchSkillInputSchema,
  outputSchema: searchSkillOutputSchema,
  annotations: {
    readOnlyHint: true,
    openWorldHint: false,
  },
})
export default class SearchSkillTool extends ToolContext {
  async execute(input: SearchSkillInput): Promise<SearchSkillOutput> {
    // Drive the bundle source to apply its first bundle (and await it) so the
    // skill registry is populated before we search. On a stateless worker this
    // is the only thing that loads the catalog within the request lifecycle.
    await this.get(BundleSyncService).ensureReady();
    const scope = this.get(ScopeEntry);
    const skillRegistry = scope.skills;
    if (!skillRegistry || !skillRegistry.hasAny()) {
      return { skills: [] };
    }

    const limit = input.limit ?? 20;
    const tags = input.tags;
    const results = await skillRegistry.search(input.query, {
      topK: limit,
      ...(tags ? { tags } : {}),
      // Anti-query demotion (honored when the skill index supports it) — surfaces
      // what the user wants while pushing down what they explicitly do not.
      ...(input.notQuery !== undefined ? { negativeQuery: input.notQuery } : {}),
      ...(input.notWeight !== undefined ? { negativeWeight: input.notWeight } : {}),
    });

    return {
      skills: results.map((r) => ({
        skillId: r.metadata.id ?? r.metadata.name,
        name: r.metadata.name,
        description: r.metadata.description ?? '',
        score: r.score,
        ...((r.metadata as { bundleVersion?: string }).bundleVersion
          ? { bundleVersion: (r.metadata as { bundleVersion?: string }).bundleVersion }
          : {}),
      })),
    };
  }
}
