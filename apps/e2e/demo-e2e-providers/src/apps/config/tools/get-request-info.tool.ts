import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { REQUEST_LOGGER_TOKEN, RequestLogger, RequestLoggerInfo } from '../providers/request-logger.provider';

const inputSchema = z
  .object({
    logMessage: z.string().optional().describe('Optional message to log'),
  })
  .strict();

const outputSchema = z.object({
  requestId: z.string(),
  sessionId: z.string(),
  createdAt: z.string(),
  instanceId: z.string(),
  logs: z.array(z.string()),
  providerScope: z.string(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'get-request-info',
  description: 'Get request info from CONTEXT scope provider (per-request instance)',
  inputSchema,
  outputSchema,
})
export default class GetRequestInfoTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    // Get the CONTEXT scope provider - new instance per request
    const logger = this.get<RequestLogger>(REQUEST_LOGGER_TOKEN);

    // Log a message if provided
    if (input.logMessage) {
      logger.log(input.logMessage);
    }

    const info = logger.getInfo();

    return {
      ...info,
      providerScope: 'CONTEXT',
    };
  }
}
