import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { deploymentLog } from '../data/deployment-log';

export const PRE_APPROVED_DEPLOYMENT = { type: 'deployment', identifier: 'prod-eu-blue' };

const inputSchema = {
  service: z.string().describe('Service to deploy'),
  context: z
    .object({ type: z.string(), identifier: z.string() })
    .optional()
    .describe('Deployment target the caller claims to be deploying to'),
};

const outputSchema = z.object({
  deployed: z.string(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'deploy-service',
  description: 'Deploys a service to production',
  inputSchema,
  outputSchema,
  approval: { required: true, preApprovedContexts: [PRE_APPROVED_DEPLOYMENT] },
})
export default class DeployServiceTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    deploymentLog.push(input.service);
    return { deployed: input.service };
  }
}
