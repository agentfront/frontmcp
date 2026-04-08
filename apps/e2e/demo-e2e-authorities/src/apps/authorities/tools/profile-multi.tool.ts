import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {
  tenantId: z.string(),
  value: z.string().default('data'),
};
type Input = z.infer<z.ZodObject<typeof inputSchema>>;

@Tool({
  name: 'profile-multi',
  description: 'A tool using multiple profiles (authenticated AND matchTenant)',
  inputSchema,
  authorities: ['authenticated', 'matchTenant'],
})
export default class ProfileMultiTool extends ToolContext<typeof inputSchema> {
  async execute(input: Input) {
    return { tenant: input.tenantId, value: input.value };
  }
}
