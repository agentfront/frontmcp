import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { DataStoreService } from '../providers/data-store.provider';

@Tool({
  name: 'store_set',
  description: 'Store a key-value pair using the GLOBAL DataStoreService provider',
  inputSchema: {
    key: z.string().describe('Key to store'),
    value: z.string().describe('Value to store'),
  },
  outputSchema: {
    success: z.boolean(),
    storeInstanceId: z.string(),
  },
})
export default class StoreSetTool extends ToolContext {
  async execute(input: { key: string; value: string }) {
    const store = this.get(DataStoreService);
    store.set(input.key, input.value);
    return { success: true, storeInstanceId: store.getInstanceId() };
  }
}
