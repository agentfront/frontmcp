// file: libs/plugins/src/codecall/tools/search.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';

import { ToolSearchService } from '../services';
import { AuditLoggerService } from '../services/audit-logger.service';
import {
  searchToolDescription,
  SearchToolInput,
  searchToolInputSchema,
  SearchToolOutput,
  searchToolOutputSchema,
} from './search.schema';

/** Internal type for tracking tool matches across queries */
interface ToolMatch {
  name: string;
  appId: string | undefined;
  description: string;
  relevanceScore: number;
  matchedQueries: string[];
}

@Tool({
  name: 'codecall:search',
  cache: {
    ttl: 60, // 1 minute
    slideWindow: false,
  },
  codecall: {
    enabledInCodeCall: false,
    visibleInListTools: true,
  },
  description: searchToolDescription,
  inputSchema: searchToolInputSchema,
  outputSchema: searchToolOutputSchema,
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
})
export default class SearchTool extends ToolContext {
  async execute(input: SearchToolInput): Promise<SearchToolOutput> {
    const { queries, appIds, excludeToolNames = [], topK = 5, minRelevanceScore = 0.3 } = input;

    const searchService = this.get(ToolSearchService);
    const warnings: SearchToolOutput['warnings'] = [];

    const audit = this.tryGet(AuditLoggerService);
    const executionId = audit ? audit.generateExecutionId() : '';
    const startedAt = Date.now();

    // Check for excluded tools that don't exist in the index
    const nonExistentExcludedTools = excludeToolNames.filter((toolName: string) => !searchService.hasTool(toolName));

    if (nonExistentExcludedTools.length > 0) {
      warnings.push({
        type: 'excluded_tool_not_found',
        message: `Excluded tools not found: ${nonExistentExcludedTools.join(', ')}`,
        affectedTools: nonExistentExcludedTools,
      });
    }

    // Track tools across all queries for deduplication
    const toolMap = new Map<string, ToolMatch>();
    let lowRelevanceCount = 0;

    // Search for each query and merge results
    for (const query of queries) {
      const searchResults = await searchService.search(query, {
        topK,
        appIds,
        excludeToolNames,
      });

      for (const result of searchResults) {
        // Filter by minRelevanceScore
        if (result.relevanceScore < minRelevanceScore) {
          lowRelevanceCount++;
          continue;
        }

        const existing = toolMap.get(result.toolName);
        if (existing) {
          // Tool already found - add query to matchedQueries, keep highest score
          existing.matchedQueries.push(query);
          existing.relevanceScore = Math.max(existing.relevanceScore, result.relevanceScore);
        } else {
          // New tool
          toolMap.set(result.toolName, {
            name: result.toolName,
            appId: result.appId,
            description: result.description,
            relevanceScore: result.relevanceScore,
            matchedQueries: [query],
          });
        }
      }
    }

    // Convert to output format, sorted by relevance
    const tools: SearchToolOutput['tools'] = Array.from(toolMap.values())
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .map((tool) => ({
        name: tool.name,
        appId: tool.appId,
        description: tool.description,
        relevanceScore: tool.relevanceScore,
        matchedQueries: tool.matchedQueries,
      }));

    // Add warning if no results found
    if (tools.length === 0) {
      warnings.push({
        type: 'no_results',
        message: `No tools found for queries: ${queries.join(', ')}${
          appIds?.length ? ` in apps: ${appIds.join(', ')}` : ''
        }`,
      });
    }

    // Add warning if results were filtered due to low relevance
    if (lowRelevanceCount > 0 && tools.length > 0) {
      warnings.push({
        type: 'low_relevance',
        message: `${lowRelevanceCount} result(s) filtered due to relevance below ${minRelevanceScore}`,
      });
    }

    // The query text is never recorded -- the service takes its length only.
    audit?.logSearch(executionId, queries.join(' '), tools.length, Date.now() - startedAt);

    return {
      tools,
      warnings,
      totalAvailableTools: searchService.getTotalCount(),
    };
  }
}
