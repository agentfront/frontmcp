// file: libs/plugins/src/codecall/tools/search-skills.tool.ts

import { Tool, ToolContext } from '@frontmcp/sdk';

import {
  searchSkillsToolDescription,
  searchSkillsToolInputSchema,
  searchSkillsToolOutputSchema,
  type SearchSkillsToolInput,
  type SearchSkillsToolOutput,
} from './search-skills.schema';

/**
 * Internal tracker so the same skill matching multiple queries dedupes into
 * one entry, keeping the highest score and collecting every query that hit.
 */
interface SkillMatch {
  name: string;
  description: string;
  tags: string[];
  operations: Array<{ spec: string; operationId: string }>;
  tools: string[];
  relevanceScore: number;
  matchedQueries: string[];
  source: 'local' | 'external';
}

@Tool({
  name: 'codecall:searchSkills',
  cache: {
    ttl: 60,
    slideWindow: false,
  },
  codecall: {
    enabledInCodeCall: false,
    visibleInListTools: true,
  },
  description: searchSkillsToolDescription,
  inputSchema: searchSkillsToolInputSchema,
  outputSchema: searchSkillsToolOutputSchema,
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
})
export default class SearchSkillsTool extends ToolContext {
  async execute(input: SearchSkillsToolInput): Promise<SearchSkillsToolOutput> {
    const { queries, tags, excludeSkillNames = [], topK = 5, minRelevanceScore = 0.1 } = input;

    // The skill registry is mounted on the scope by the SDK; this is the
    // same access path the existing skill flow uses.
    const skillRegistry = this.scope.skills;

    // `getExecutableSkills()` defaults to `includeHidden: false`, so any
    // skill that's executable AND `hideFromDiscovery: true` is intentionally
    // excluded from this discovery surface. The result loop below double-
    // checks against `executableSet`, which also drops hidden-executable
    // skills that the underlying `registry.search()` might still surface.
    // To search hidden skills, callers should use the SDK directly.
    const executableSkills = skillRegistry.getExecutableSkills();
    const executableSet = new Set(executableSkills.map((s) => s.name));
    const totalExecutableSkills = executableSkills.length;

    const warnings: SearchSkillsToolOutput['warnings'] = [];

    // Validate the excludeSkillNames input — if a caller excludes a skill
    // that doesn't exist, surface it as a warning rather than silently
    // ignoring (parity with the existing search.tool.ts behaviour).
    const nonExistentExcluded = excludeSkillNames.filter((n) => !executableSet.has(n));
    if (nonExistentExcluded.length > 0) {
      warnings.push({
        type: 'excluded_skill_not_found',
        message: `Excluded skills not found: ${nonExistentExcluded.join(', ')}`,
        affectedSkills: nonExistentExcluded,
      });
    }

    const matches = new Map<string, SkillMatch>();
    let lowRelevanceCount = 0;
    const excludedSet = new Set(excludeSkillNames);

    // Dispatch every query concurrently. The storage provider may be remote
    // (HTTP, Redis-backed semantic search) so serial awaits would multiply
    // the search latency by `queries.length`. Each result row is small and
    // de-duplication happens once after all queries return.
    const perQueryResults = await Promise.all(
      queries.map((query) =>
        skillRegistry
          .search(query, { topK, tags, minScore: minRelevanceScore })
          .then((results) => ({ query, results })),
      ),
    );

    for (const { query, results } of perQueryResults) {
      for (const result of results) {
        const name = result.metadata.name;

        // Restrict to executable skills (the registry's search returns ALL
        // skills regardless of executable/knowledge-only kind).
        if (!executableSet.has(name)) continue;

        // Honour caller exclusions.
        if (excludedSet.has(name)) continue;

        // Filter by minRelevanceScore — the registry storage providers
        // honour `minScore` but some implementations may return tied-score
        // hits at the boundary; double-check here for safety.
        if (result.score < minRelevanceScore) {
          lowRelevanceCount++;
          continue;
        }

        const existing = matches.get(name);
        if (existing) {
          existing.matchedQueries.push(query);
          existing.relevanceScore = Math.max(existing.relevanceScore, result.score);
        } else {
          const ops = result.metadata.referencedOperations ?? [];
          const toolNames = (result.metadata.tools ?? [])
            .map((t) => {
              if (typeof t === 'string') return t;
              if (typeof t === 'object' && t !== null && 'name' in t) return (t as { name: string }).name;
              return null;
            })
            .filter((n): n is string => typeof n === 'string');

          matches.set(name, {
            name,
            description: result.metadata.description,
            tags: result.metadata.tags ?? [],
            operations: ops.map((op) => ({ spec: op.spec, operationId: op.operationId })),
            tools: toolNames,
            relevanceScore: result.score,
            matchedQueries: [query],
            source: result.source,
          });
        }
      }
    }

    const skills = Array.from(matches.values()).sort((a, b) => b.relevanceScore - a.relevanceScore);

    if (skills.length === 0) {
      warnings.push({
        type: 'no_results',
        message: `No executable skills found for queries: ${queries.join(', ')}${
          tags?.length ? ` with tags: ${tags.join(', ')}` : ''
        }`,
      });
    }
    if (lowRelevanceCount > 0 && skills.length > 0) {
      warnings.push({
        type: 'low_relevance',
        message: `${lowRelevanceCount} result(s) filtered due to relevance below ${minRelevanceScore}`,
      });
    }

    return { skills, warnings, totalExecutableSkills };
  }
}
