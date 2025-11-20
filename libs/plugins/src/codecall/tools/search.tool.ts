// file: libs/plugins/src/codecall/tools/search.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import { SearchToolInput, searchToolInputSchema, SearchToolOutput, searchToolOutputSchema } from './search.schema';

@Tool({
  name: 'codecall:search',
  cache: {
    ttl: 60, // 1 minute
    slideWindow: false,
  },
  description: `Search for tools that match your current task requirements. Use this to discover what tools are available before calling them.

WORKFLOW GUIDELINES:
1. FIRST TIME SEARCH: When starting a new task, search for relevant tools using a descriptive query
2. AVOID RE-SEARCHING: Do NOT search for tools you have already discovered in this conversation
3. USE excludeToolNames: When searching again, ALWAYS include tool names you've already fetched to avoid redundant results
4. NARROW YOUR SCOPE: Use filter.appIds to search within specific apps (e.g., ["user", "billing"]) when you know the domain
5. HANDLE WARNINGS: Check the warnings array - if excluded tools don't exist, you may have made an assumption error

SEARCH STRATEGY:
- Start broad, then narrow down with filters
- Use specific, action-oriented queries (e.g., "get user profile", "list invoices")
- Track tool names you discover and exclude them in subsequent searches
- Only re-search if you need different functionality or the describe tool failed for a specific tool

EXAMPLE FLOW:
1. Search: "get user information" → Get results
2. Describe: Check schemas for found tools
3. Later search: "update user settings" with excludeToolNames: ["users:getById", "users:list"] → Get NEW tools only

The search returns tools sorted by relevance with scores. Higher scores mean better matches to your query.`,
  inputSchema: searchToolInputSchema,
  outputSchema: searchToolOutputSchema,
})
export default class SearchTool extends ToolContext {
  async execute(input: SearchToolInput): Promise<SearchToolOutput> {
    const {
      query,
      filter,
      excludeToolNames = [],
      topK: _topK = 8, // Will be used when implementing actual search
    } = input;

    // TODO: Implement actual tool search logic
    // This is a placeholder implementation that should be replaced with:
    // 1. Access to the CodeCall plugin's tool index
    // 2. Semantic search or keyword matching against tool names/descriptions
    // 3. Filtering by appIds if provided
    // 4. Excluding already-fetched tools
    // 5. Ranking by relevance score
    // 6. Detecting excluded tools that don't exist in the index

    const warnings: SearchToolOutput['warnings'] = [];
    const results: SearchToolOutput['results'] = [];

    // Placeholder: Check for excluded tools that don't exist
    // In real implementation, this would check against the actual tool index
    const nonExistentExcludedTools = excludeToolNames.filter((_toolName: string) => {
      // TODO: Check if toolName exists in the actual index
      // For now, this is a placeholder
      return false;
    });

    if (nonExistentExcludedTools.length > 0) {
      warnings.push({
        type: 'excluded_tool_not_found',
        message: `The following excluded tools were not found in the tool index: ${nonExistentExcludedTools.join(
          ', ',
        )}. You may have assumed these tool names incorrectly. Only exclude tools you have actually discovered through search.`,
        affectedTools: nonExistentExcludedTools,
      });
    }

    // TODO: Implement actual search
    // Example placeholder structure:
    // const allTools = await this.getToolIndex();
    // const filteredByApp = filter?.appIds
    //   ? allTools.filter(t => filter.appIds.includes(t.appId))
    //   : allTools;
    // const excludedSet = new Set(excludeToolNames);
    // const candidateTools = filteredByApp.filter(t => !excludedSet.has(t.name));
    // const rankedTools = await this.rankByRelevance(candidateTools, query);
    // const topResults = rankedTools.slice(0, topK);

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
      totalAvailableTools: 0, // TODO: Replace with actual count from index
    };
  }
}
