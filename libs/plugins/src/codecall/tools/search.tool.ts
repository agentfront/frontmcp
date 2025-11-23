// file: libs/plugins/src/codecall/tools/search.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import {
  SearchToolInput,
  searchToolInputSchema,
  SearchToolOutput,
  searchToolOutputSchema,
  searchToolDescription,
} from './search.schema';
import { ToolSearchService } from '../services/tool-search.service';

// Singleton instance of the search service
let searchServiceInstance: ToolSearchService | null = null;

@Tool({
  name: 'codecall:search',
  cache: {
    ttl: 60, // 1 minute
    slideWindow: false,
  },
  description: searchToolDescription,
  inputSchema: searchToolInputSchema,
  outputSchema: searchToolOutputSchema,
})
export default class SearchTool extends ToolContext {
  private getSearchService(): ToolSearchService {
    if (!searchServiceInstance) {
      searchServiceInstance = new ToolSearchService();

      // Initialize with all tools from the scope
      const allTools = this.scope.tools.getTools(true);
      searchServiceInstance.initialize(allTools);
    }

    return searchServiceInstance;
  }

  async execute(input: SearchToolInput): Promise<SearchToolOutput> {
    const { query, filter, excludeToolNames = [], topK = 8 } = input;

    const searchService = this.getSearchService();
    const warnings: SearchToolOutput['warnings'] = [];

    // Check for excluded tools that don't exist in the index
    const nonExistentExcludedTools = excludeToolNames.filter((toolName: string) => !searchService.hasTool(toolName));

    if (nonExistentExcludedTools.length > 0) {
      warnings.push({
        type: 'excluded_tool_not_found',
        message: `The following excluded tools were not found in the tool index: ${nonExistentExcludedTools.join(
          ', ',
        )}. You may have assumed these tool names incorrectly. Only exclude tools you have actually discovered through search.`,
        affectedTools: nonExistentExcludedTools,
      });
    }

    // Perform the search
    const searchResults = searchService.search(query, {
      topK,
      appIds: filter?.appIds,
      excludeToolNames,
      minScore: 0.0, // Include all results with any relevance
    });

    // Convert search results to output format
    const results: SearchToolOutput['results'] = searchResults.map((result) => ({
      name: result.toolName,
      appId: result.appId || 'unknown',
      description: result.tool.metadata.description || '',
      relevanceScore: result.score,
    }));

    // Add warning if no results found
    if (results.length === 0) {
      warnings.push({
        type: 'no_results',
        message: `No tools found matching query "${query}"${
          filter?.appIds ? ` in apps: ${filter.appIds.join(', ')}` : ''
        }. Try a broader query or remove app filters.`,
      });
    }

    return {
      results,
      warnings,
      totalAvailableTools: searchService.getTotalCount(),
    };
  }
}
