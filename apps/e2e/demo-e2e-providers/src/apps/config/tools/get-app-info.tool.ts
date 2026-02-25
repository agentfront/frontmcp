import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { AppConfigProvider, AppConfig } from '../providers/app-config.provider';

const inputSchema = {};

const outputSchema = z.object({
  appName: z.string(),
  version: z.string(),
  environment: z.string(),
  startedAt: z.string(),
  instanceId: z.string(),
  providerScope: z.string(),
});

type Input = z.input<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

// Singleton instance
let appConfigProviderInstance: AppConfigProvider | null = null;

@Tool({
  name: 'get-app-info',
  description: 'Get application info from GLOBAL scope provider (singleton)',
  inputSchema,
  outputSchema,
})
export default class GetAppInfoTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    // Get the GLOBAL scope provider - use singleton pattern
    if (!appConfigProviderInstance) {
      appConfigProviderInstance = new AppConfigProvider();
    }
    const config = appConfigProviderInstance;
    const info = config.getInfo();

    return {
      appName: info.appName,
      version: info.version,
      environment: info.environment,
      startedAt: info.startedAt.toISOString(),
      instanceId: info.instanceId,
      providerScope: 'GLOBAL',
    };
  }
}
