import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { deploymentLog } from '../data/deployment-log';

const inputSchema = {};

const outputSchema = z.object({
  rotated: z.boolean(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'rotate-keys',
  description: 'Rotates the production signing keys; asks for approval on every call',
  inputSchema,
  outputSchema,
  approval: { required: true, riskLevel: 'critical', alwaysPrompt: true },
})
export default class RotateKeysTool extends ToolContext {
  async execute(_input: Input): Promise<Output> {
    deploymentLog.push('rotate-keys');
    return { rotated: true };
  }
}
