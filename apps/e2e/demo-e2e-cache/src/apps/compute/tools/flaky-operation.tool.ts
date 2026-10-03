import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext, type CallToolResult } from '@frontmcp/sdk';

import { executionTracker } from '../data/execution-tracker';

const inputSchema = {
  operationId: z.string().describe('Unique operation identifier'),
};

type Input = z.infer<z.ZodObject<typeof inputSchema>>;

/** Operations that already failed once: each fails on its first run and succeeds afterwards. */
const failedOnce = new Set<string>();

@Tool({
  name: 'flaky-operation',
  description: 'Reports a failure (isError) on the first run of an operation, then succeeds; caching enabled',
  inputSchema,
  cache: true,
})
export default class FlakyOperationTool extends ToolContext {
  async execute(input: Input): Promise<CallToolResult> {
    const executionCount = executionTracker.increment('flaky-operation');

    if (!failedOnce.has(input.operationId)) {
      failedOnce.add(input.operationId);
      return { content: [{ type: 'text', text: `upstream timed out (execution ${executionCount})` }], isError: true };
    }

    return { content: [{ type: 'text', text: `operation ${input.operationId} done (execution ${executionCount})` }] };
  }
}
