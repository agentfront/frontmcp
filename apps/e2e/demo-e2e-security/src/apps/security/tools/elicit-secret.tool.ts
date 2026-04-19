import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = { prompt: z.string() };
const outputSchema = z.object({ received: z.string().optional(), status: z.string() });

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

/**
 * Triggers an elicitation against the caller. Used by the "cross-session
 * elicitation spoofing" security test: session A calls this tool (and does
 * NOT register an elicitation handler on its client), so the request stays
 * blocked on a pending elicit while session B attempts to poison it.
 *
 * No `authorities` — we're testing the elicitation layer, not tool RBAC.
 */
@Tool({
  name: 'elicit-secret',
  description: 'Ask the calling client for a secret via elicitation.',
  inputSchema,
  outputSchema,
})
export default class ElicitSecretTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    const result = await this.elicit(input.prompt, z.object({ secret: z.string() }), {
      mode: 'form',
      ttl: 2_000,
    });
    if (result.status !== 'accept') {
      return { status: result.status };
    }
    return { status: 'accept', received: result.content?.secret };
  }
}
