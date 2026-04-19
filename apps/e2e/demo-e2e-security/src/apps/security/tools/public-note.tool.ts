import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = { message: z.string() };
const outputSchema = z.object({ echo: z.string() });

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

/**
 * No authorities — any authenticated caller succeeds. Used as a baseline
 * "positive" control: if this ever denies an authenticated caller, the auth
 * pipeline is broken at a layer BELOW RBAC.
 */
@Tool({
  name: 'public-note',
  description: 'Echoes a message. No authorities — accepts any authenticated caller.',
  inputSchema,
  outputSchema,
})
export default class PublicNoteTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    return { echo: input.message };
  }
}
