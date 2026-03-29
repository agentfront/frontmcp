import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { DataStoreService } from '../providers/data-store.provider';

@Tool({
  name: 'store_get',
  description: 'Get a value from the GLOBAL DataStoreService provider',
  inputSchema: {
    key: z.string().describe('Key to retrieve'),
  },
  outputSchema: {
    found: z.boolean(),
    value: z.string().optional(),
    storeInstanceId: z.string(),
  },
})
export default class StoreGetTool extends ToolContext {
  async execute(input: { key: string }) {
    const store = this.get(DataStoreService);
    const entry = store.get(input.key);
    return {
      found: !!entry,
      value: entry?.value,
      storeInstanceId: store.getInstanceId(),
    };
  }
}
