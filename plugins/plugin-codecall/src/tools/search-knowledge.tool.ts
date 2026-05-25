// file: libs/plugins/src/codecall/tools/search-knowledge.tool.ts

import { Tool, ToolContext } from '@frontmcp/sdk';

import {
  searchKnowledgeToolDescription,
  searchKnowledgeToolInputSchema,
  searchKnowledgeToolOutputSchema,
  type SearchKnowledgeToolInput,
  type SearchKnowledgeToolOutput,
} from './search-knowledge.schema';

interface KnowledgeMatch {
  name: string;
  description: string;
  tags: string[];
  relevanceScore: number;
  matchedQueries: string[];
  source: 'local' | 'external';
}

@Tool({
  name: 'codecall:searchKnowledge',
  cache: {
    ttl: 60,
    slideWindow: false,
  },
  codecall: {
    enabledInCodeCall: false,
    visibleInListTools: true,
  },
  description: searchKnowledgeToolDescription,
  inputSchema: searchKnowledgeToolInputSchema,
  outputSchema: searchKnowledgeToolOutputSchema,
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
})
export default class SearchKnowledgeTool extends ToolContext {
  async execute(input: SearchKnowledgeToolInput): Promise<SearchKnowledgeToolOutput> {
    const { queries, tags, excludeSkillNames = [], topK = 5, minRelevanceScore = 0.1 } = input;

    const skillRegistry = this.scope.skills;

    const knowledgeSkills = skillRegistry.getKnowledgeOnlySkills();
    const knowledgeSet = new Set(knowledgeSkills.map((s) => s.name));
    const totalKnowledgeSkills = knowledgeSkills.length;

    const warnings: SearchKnowledgeToolOutput['warnings'] = [];

    const nonExistentExcluded = excludeSkillNames.filter((n) => !knowledgeSet.has(n));
    if (nonExistentExcluded.length > 0) {
      warnings.push({
        type: 'excluded_skill_not_found',
        message: `Excluded knowledge skills not found: ${nonExistentExcluded.join(', ')}`,
        affectedSkills: nonExistentExcluded,
      });
    }

    const matches = new Map<string, KnowledgeMatch>();
    let lowRelevanceCount = 0;
    const excludedSet = new Set(excludeSkillNames);

    for (const query of queries) {
      const results = await skillRegistry.search(query, {
        topK,
        tags,
        minScore: minRelevanceScore,
      });

      for (const result of results) {
        const name = result.metadata.name;
        if (!knowledgeSet.has(name)) continue; // skip executable skills
        if (excludedSet.has(name)) continue;
        if (result.score < minRelevanceScore) {
          lowRelevanceCount++;
          continue;
        }

        const existing = matches.get(name);
        if (existing) {
          existing.matchedQueries.push(query);
          existing.relevanceScore = Math.max(existing.relevanceScore, result.score);
        } else {
          matches.set(name, {
            name,
            description: result.metadata.description,
            tags: result.metadata.tags ?? [],
            relevanceScore: result.score,
            matchedQueries: [query],
            source: result.source,
          });
        }
      }
    }

    const knowledge = Array.from(matches.values()).sort((a, b) => b.relevanceScore - a.relevanceScore);

    if (knowledge.length === 0) {
      warnings.push({
        type: 'no_results',
        message: `No knowledge skills found for queries: ${queries.join(', ')}${
          tags?.length ? ` with tags: ${tags.join(', ')}` : ''
        }`,
      });
    }
    if (lowRelevanceCount > 0 && knowledge.length > 0) {
      warnings.push({
        type: 'low_relevance',
        message: `${lowRelevanceCount} result(s) filtered due to relevance below ${minRelevanceScore}`,
      });
    }

    return { knowledge, warnings, totalKnowledgeSkills };
  }
}
