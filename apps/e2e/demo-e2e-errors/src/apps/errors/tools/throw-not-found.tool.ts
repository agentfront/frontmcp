import { Tool, ToolContext, ResourceNotFoundError } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {
  resourceId: z.string().describe('Resource ID to look up'),
};

const outputSchema = z
  .object({
    found: z.boolean(),
    resourceId: z.string(),
  })
  .strict();

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

// Simulated database of existing resources
const existingResources = new Set(['resource-1', 'resource-2', 'resource-3']);

@Tool({
  name: 'throw-not-found',
  description: 'Throws a ResourceNotFoundError if resource does not exist',
  inputSchema,
  outputSchema,
})
export default class ThrowNotFoundTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    if (!existingResources.has(input.resourceId)) {
      throw new ResourceNotFoundError(`resource://${input.resourceId}`);
    }

    return {
      found: true,
      resourceId: input.resourceId,
    };
  }
}
