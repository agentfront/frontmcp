import { Resource, ResourceContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { AppConfigProvider } from '../providers/app-config.provider';

const outputSchema = z.object({
  appName: z.string(),
  version: z.string(),
  environment: z.string(),
  startedAt: z.string(),
  instanceId: z.string(),
  uptime: z.number(),
});

// Singleton instance
let appConfigProviderInstance: AppConfigProvider | null = null;

@Resource({
  uri: 'config://app',
  name: 'App Configuration',
  description: 'Current application configuration from GLOBAL provider',
  mimeType: 'application/json',
})
export default class AppConfigResource extends ResourceContext<Record<string, never>, z.infer<typeof outputSchema>> {
  async execute(): Promise<z.infer<typeof outputSchema>> {
    // Use singleton pattern since we can't use this.get() in resources
    if (!appConfigProviderInstance) {
      appConfigProviderInstance = new AppConfigProvider();
    }
    const config = appConfigProviderInstance;
    const info = config.getInfo();
    const uptime = Date.now() - info.startedAt.getTime();

    return {
      appName: info.appName,
      version: info.version,
      environment: info.environment,
      startedAt: info.startedAt.toISOString(),
      instanceId: info.instanceId,
      uptime,
    };
  }
}
