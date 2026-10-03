import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

/** The gate keys approvals by the tool's full name, which includes its app id. */
const ROTATE_KEYS_TOOL_ID = 'ops:rotate-keys';

const inputSchema = {};

const outputSchema = z.object({
  approved: z.string(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'approve-rotate-keys',
  description: 'Grants the calling session approval to run rotate-keys',
  inputSchema,
  outputSchema,
})
export default class ApproveRotateKeysTool extends ToolContext {
  async execute(_input: Input): Promise<Output> {
    await this.approval.grantSessionApproval(ROTATE_KEYS_TOOL_ID);
    return { approved: ROTATE_KEYS_TOOL_ID };
  }
}
