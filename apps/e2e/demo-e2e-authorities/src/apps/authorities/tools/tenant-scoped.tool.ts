import { z } from 'zod';

import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  tenantId: z.string(),
  data: z.string().default('payload'),
};
type Input = z.infer<z.ZodObject<typeof inputSchema>>;

@Tool({
  name: 'tenant-scoped',
  description: 'A tool that validates tenant match (ABAC with dynamic fromInput)',
  inputSchema,
  authorities: {
    attributes: {
      conditions: [{ path: 'claims.tenantId', op: 'eq', value: { fromInput: 'tenantId' } }],
    },
  },
})
export default class TenantScopedTool extends ToolContext {
  async execute(input: Input) {
    return { tenant: input.tenantId, data: input.data };
  }
}
