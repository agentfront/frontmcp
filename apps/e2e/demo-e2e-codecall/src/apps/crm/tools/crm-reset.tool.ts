import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { crmStore } from '../data/crm.store';

const inputSchema = {};
const outputSchema = z.object({ success: z.boolean() });

@Tool({
  name: 'crm-reset',
  description: 'Reset CRM store to initial seed data (for testing)',
  inputSchema,
  outputSchema,
  // Listed, so the specs can call it directly: in codecall_only mode a client's direct
  // tools/call of a tool CodeCall hides is refused.
  codecall: { visibleInListTools: true },
})
export default class CrmResetTool extends ToolContext {
  async execute(_input: z.infer<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    crmStore.reset();
    return { success: true };
  }
}
