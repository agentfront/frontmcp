import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { deploymentTracker } from '../data/deployment-tracker';

const inputSchema = {};

const outputSchema = z.object({
  platform: z.string(),
  runtime: z.string(),
  region: z.string(),
  functionName: z.string(),
  memoryLimit: z.string(),
  timeout: z.string(),
  isServerless: z.boolean(),
  stats: z.object({
    totalInvocations: z.number(),
    uptime: z.number(),
    coldStarts: z.number(),
    warmStarts: z.number(),
    averageDuration: z.number(),
  }),
});

type Input = z.input<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'serverless-info',
  description: 'Returns deployment environment information',
  inputSchema,
  outputSchema,
})
export default class ServerlessInfoTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(_input: Input): Promise<Output> {
    const tracker = deploymentTracker;
    const start = Date.now();

    // Detect platform from environment variables
    const platform = this.detectPlatform();
    const runtime = process.version;
    const region = this.getRegion();
    const functionName = this.getFunctionName();
    const memoryLimit = this.getMemoryLimit();
    const timeout = this.getTimeout();
    const isServerless = process.env['FRONTMCP_SERVERLESS'] === '1';

    // Record this invocation
    const duration = Date.now() - start;
    tracker.recordInvocation(platform, duration);

    return {
      platform,
      runtime,
      region,
      functionName,
      memoryLimit,
      timeout,
      isServerless,
      stats: tracker.getStats(),
    };
  }

  private detectPlatform(): string {
    // Vercel
    if (process.env['VERCEL']) return 'vercel';
    if (process.env['VERCEL_ENV']) return 'vercel';

    // AWS Lambda
    if (process.env['AWS_LAMBDA_FUNCTION_NAME']) return 'aws-lambda';
    if (process.env['LAMBDA_TASK_ROOT']) return 'aws-lambda';

    // Cloudflare Workers (typically has different runtime)
    if (process.env['CF_PAGES']) return 'cloudflare-pages';
    if (process.env['WORKERS_ENV']) return 'cloudflare-workers';

    // Netlify
    if (process.env['NETLIFY']) return 'netlify';

    // Deno Deploy
    if (typeof (globalThis as Record<string, unknown>)['Deno'] !== 'undefined') return 'deno-deploy';

    // Local/development
    if (process.env['NODE_ENV'] === 'development') return 'local-development';
    if (process.env['NODE_ENV'] === 'test') return 'test';

    return 'unknown';
  }

  private getRegion(): string {
    return (
      process.env['AWS_REGION'] ??
      process.env['VERCEL_REGION'] ??
      process.env['REGION'] ??
      process.env['FLY_REGION'] ??
      'local'
    );
  }

  private getFunctionName(): string {
    return (
      process.env['AWS_LAMBDA_FUNCTION_NAME'] ??
      process.env['VERCEL_URL'] ??
      process.env['FUNCTION_NAME'] ??
      'demo-e2e-serverless'
    );
  }

  private getMemoryLimit(): string {
    const mb = process.env['AWS_LAMBDA_FUNCTION_MEMORY_SIZE'];
    if (mb) return `${mb}MB`;

    // Node.js heap size
    const heapSize = Math.round(process.memoryUsage().heapTotal / (1024 * 1024));
    return `${heapSize}MB (heap)`;
  }

  private getTimeout(): string {
    const seconds = process.env['AWS_LAMBDA_FUNCTION_TIMEOUT'];
    if (seconds) return `${seconds}s`;

    return 'N/A';
  }
}
