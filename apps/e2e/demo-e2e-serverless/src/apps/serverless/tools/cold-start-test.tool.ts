import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { deploymentTracker } from '../data/deployment-tracker';

const inputSchema = {
  simulateColdStart: z.boolean().optional().default(false).describe('Simulate a cold start for testing'),
};

const outputSchema = z.object({
  isColdStart: z.boolean(),
  invocationId: z.string(),
  duration: z.number(),
  previousInvocations: z.array(
    z.object({
      id: z.string(),
      timestamp: z.number(),
      isColdStart: z.boolean(),
      duration: z.number(),
      platform: z.string(),
    }),
  ),
  message: z.string(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'cold-start-test',
  description: 'Tests cold start behavior in serverless environments',
  inputSchema,
  outputSchema,
})
export default class ColdStartTestTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    const tracker = deploymentTracker;
    const start = Date.now();

    // Optionally simulate cold start
    if (input.simulateColdStart) {
      tracker.simulateColdStart();
    }

    // Check current cold start status
    const isColdStart = tracker.checkColdStart();

    // Simulate some work
    await this.simulateWork();

    const duration = Date.now() - start;

    // Record the invocation
    const platform = this.detectPlatform();
    const record = tracker.recordInvocation(platform, duration);

    // Get recent invocations for context
    const previousInvocations = tracker.getRecentInvocations(5);

    const message = isColdStart
      ? 'This was a cold start - function container was freshly initialized'
      : 'This was a warm start - function container was already running';

    return {
      isColdStart,
      invocationId: record.id,
      duration,
      previousInvocations,
      message,
    };
  }

  private async simulateWork(): Promise<void> {
    // Simulate some initialization work that would happen on cold start
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  private detectPlatform(): string {
    if (process.env['VERCEL']) return 'vercel';
    if (process.env['AWS_LAMBDA_FUNCTION_NAME']) return 'aws-lambda';
    if (process.env['CF_PAGES']) return 'cloudflare-pages';
    if (process.env['NODE_ENV'] === 'test') return 'test';
    return 'local';
  }
}
