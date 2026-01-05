import { Resource, ResourceContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { RememberAccessorToken } from '@frontmcp/plugins/remember';

const outputSchema = z.object({
  session: z.object({
    keyCount: z.number(),
    keys: z.array(z.string()),
  }),
  global: z.object({
    keyCount: z.number(),
    keys: z.array(z.string()),
  }),
  timestamp: z.string(),
});

type Output = z.infer<typeof outputSchema>;

@Resource({
  name: 'memory-stats',
  uri: 'memory://stats',
  description: 'Get memory statistics for the current session',
  mimeType: 'application/json',
})
export default class MemoryStatsResource extends ResourceContext<Record<string, never>, Output> {
  async execute(): Promise<Output> {
    const remember = this.get(RememberAccessorToken);
    const sessionKeys = await remember.list({ scope: 'session' });
    const globalKeys = await remember.list({ scope: 'global' });

    return {
      session: {
        keyCount: sessionKeys.length,
        keys: sessionKeys,
      },
      global: {
        keyCount: globalKeys.length,
        keys: globalKeys,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
