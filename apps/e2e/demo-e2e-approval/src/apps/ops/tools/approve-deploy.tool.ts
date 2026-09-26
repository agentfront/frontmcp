import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

/** The gate keys approvals by the tool's full name, which includes its app id. */
const DEPLOY_SERVICE_TOOL_ID = 'ops:deploy-service';

const inputSchema = {};

const outputSchema = z.object({
  approved: z.string(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'approve-deploy',
  description: 'Grants the calling session approval to run deploy-service',
  inputSchema,
  outputSchema,
})
export default class ApproveDeployTool extends ToolContext {
  async execute(_input: Input): Promise<Output> {
    await this.approval.grantSessionApproval(DEPLOY_SERVICE_TOOL_ID);
    return { approved: DEPLOY_SERVICE_TOOL_ID };
  }
}
