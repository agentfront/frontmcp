import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  id: z.string().describe('The approval id a CodeCall needs_approval result returned'),
};

/** Stands for the server's own approval screen: a person approves what CodeCall's review asked for. */
@Tool({
  name: 'approvals-grant',
  description: 'Approve a CodeCall approval id for this session',
  inputSchema,
  codecall: { visibleInListTools: true, enabledInCodeCall: false },
})
export default class ApprovalsGrantTool extends ToolContext {
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>) {
    await this.approval.grantSessionApproval(input.id);
    return { granted: input.id };
  }
}
