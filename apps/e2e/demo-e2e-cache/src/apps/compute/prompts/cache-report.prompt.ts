import { Prompt, PromptContext, GetPromptResult } from '@frontmcp/sdk';
import { z } from 'zod';
import { executionTracker } from '../data/execution-tracker';

const argsSchema = [];

@Prompt({
  name: 'cache-report',
  description: 'Generate a cache performance report',
  arguments: argsSchema,
})
export default class CacheReportPrompt extends PromptContext {
  async execute(_args: Record<string, string>): Promise<GetPromptResult> {
    const counts = executionTracker.getAll();
    const totalExecutions = Object.values(counts).reduce((a, b) => a + b, 0);

    const toolStats = Object.entries(counts)
      .map(([tool, count]) => `- ${tool}: ${count} executions`)
      .join('\n');

    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Please analyze this cache performance report:

## Execution Statistics

Total Executions: ${totalExecutions}
Tracked Tools: ${Object.keys(counts).length}

### Per-Tool Breakdown
${toolStats || 'No executions recorded yet'}

## Analysis Notes

- The "expensive-operation" tool has cache: { ttl: 30 } enabled
- The "non-cached" tool does NOT have caching
- Compare execution counts to verify cache effectiveness
- Lower execution count for cached tools indicates cache hits`,
          },
        },
      ],
      description: 'Cache performance analysis report',
    };
  }
}
