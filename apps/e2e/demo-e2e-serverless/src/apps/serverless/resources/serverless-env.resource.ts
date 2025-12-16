import { Resource, ResourceContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { deploymentTracker } from '../data/deployment-tracker';

const outputSchema = z.object({
  environment: z.object({
    nodeVersion: z.string(),
    platform: z.string(),
    arch: z.string(),
    pid: z.number(),
    cwd: z.string(),
    isServerless: z.boolean(),
    env: z.record(z.string(), z.string()),
  }),
  process: z.object({
    uptime: z.number(),
    memoryUsage: z.object({
      rss: z.number(),
      heapTotal: z.number(),
      heapUsed: z.number(),
      external: z.number(),
    }),
  }),
  tracker: z.object({
    totalInvocations: z.number(),
    uptime: z.number(),
    coldStarts: z.number(),
    warmStarts: z.number(),
    averageDuration: z.number(),
  }),
});

type Output = z.infer<typeof outputSchema>;

@Resource({
  uri: 'serverless://env',
  name: 'Serverless Environment',
  description: 'Current serverless deployment environment information',
  mimeType: 'application/json',
})
export default class ServerlessEnvResource extends ResourceContext<Record<string, never>, Output> {
  async execute(): Promise<Output> {
    const tracker = deploymentTracker;
    const mem = process.memoryUsage();

    // Filter environment variables to include only relevant ones
    const relevantEnvKeys = [
      'NODE_ENV',
      'FRONTMCP_SERVERLESS',
      'VERCEL',
      'VERCEL_ENV',
      'VERCEL_REGION',
      'AWS_REGION',
      'AWS_LAMBDA_FUNCTION_NAME',
      'AWS_LAMBDA_FUNCTION_MEMORY_SIZE',
      'CF_PAGES',
      'NETLIFY',
    ];

    const filteredEnv: Record<string, string> = {};
    for (const key of relevantEnvKeys) {
      if (process.env[key]) {
        filteredEnv[key] = process.env[key] as string;
      }
    }

    return {
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        cwd: process.cwd(),
        isServerless: process.env['FRONTMCP_SERVERLESS'] === '1',
        env: filteredEnv,
      },
      process: {
        uptime: Math.round(process.uptime()),
        memoryUsage: {
          rss: Math.round(mem.rss / (1024 * 1024)),
          heapTotal: Math.round(mem.heapTotal / (1024 * 1024)),
          heapUsed: Math.round(mem.heapUsed / (1024 * 1024)),
          external: Math.round(mem.external / (1024 * 1024)),
        },
      },
      tracker: tracker.getStats(),
    };
  }
}
