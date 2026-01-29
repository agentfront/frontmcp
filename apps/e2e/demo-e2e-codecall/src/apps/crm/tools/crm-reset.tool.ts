import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { crmStore } from '../data/crm.store';

const inputSchema = z.object({}).strict();
const outputSchema = z.object({ success: z.boolean() });

@Tool({
  name: 'crm-reset',
  description: 'Reset CRM store to initial seed data (for testing)',
  inputSchema,
  outputSchema,
})
export default class CrmResetTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(): Promise<z.infer<typeof outputSchema>> {
    crmStore.reset();
    return { success: true };
  }
}
