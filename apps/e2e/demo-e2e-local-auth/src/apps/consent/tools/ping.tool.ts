import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {};

const outputSchema = z.object({ ok: z.boolean() });

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

/**
 * An "essential" tool used by the consent E2E as an `excludedTools` member:
 * it is never offered on the consent screen and is always callable regardless
 * of the user's tool selection.
 */
@Tool({
  name: 'ping',
  description: 'Health-check tool that is always available (excluded from consent)',
  inputSchema,
  outputSchema,
})
export default class PingTool extends ToolContext {
  async execute(_input: Input): Promise<Output> {
    return { ok: true };
  }
}
