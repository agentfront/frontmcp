import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { deploymentLog } from '../data/deployment-log';

const inputSchema = {};

const outputSchema = z.object({
  deployed: z.array(z.string()),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'deployment-log',
  description: 'Lists the services deploy-service has actually deployed',
  inputSchema,
  outputSchema,
})
export default class DeploymentLogTool extends ToolContext {
  async execute(_input: Input): Promise<Output> {
    return { deployed: [...deploymentLog] };
  }
}
