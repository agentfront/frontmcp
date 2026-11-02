import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { callSpanStatuses, toolRequestLogs } from '../telemetry-records';

const inputSchema = {
  toolName: z.string().describe('The tool whose calls to report'),
};

const outputSchema = z.object({
  spans: z.array(z.object({ tool: z.string(), call: z.string() })),
  requestLogs: z.array(z.object({ status: z.string(), errorCode: z.string().optional() })),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'get-telemetry',
  description: 'The span statuses and the request logs of the calls of one tool',
  inputSchema,
  outputSchema,
})
export default class GetTelemetryTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    return { spans: callSpanStatuses(input.toolName), requestLogs: toolRequestLogs(input.toolName) };
  }
}
