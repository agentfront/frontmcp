import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { DataStoreService } from '../providers/data-store.provider';

@Tool({
  name: 'debug_providers',
  description: 'Debug tool that reports provider resolution details',
  inputSchema: {},
  outputSchema: {
    providersType: z.string(),
    storeInstanceId: z.string(),
    error: z.string().optional(),
  },
})
export default class DebugProvidersTool extends ToolContext {
  async execute(_input: Record<string, never>) {
    const providersType = this.providers?.constructor?.name ?? 'unknown';
    let storeInstanceId = 'NOT_RESOLVED';
    let error = '';

    try {
      const store = this.get(DataStoreService);
      storeInstanceId = store.getInstanceId();
    } catch (e: unknown) {
      error = e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e);
    }

    return {
      providersType,
      storeInstanceId,
      error: error || undefined,
    };
  }
}
