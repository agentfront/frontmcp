import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  action: z.string().describe('Action to confirm'),
};

const outputSchema = z.object({
  action: z.string(),
  confirmed: z.boolean(),
});

type Input = z.output<z.ZodObject<typeof inputSchema>>;
type Output = z.output<typeof outputSchema>;

/**
 * Drives the Multi Round-Trip Requests (MRTR) path introduced in 2026-07-28.
 *
 * Under 2026-07-28 there is no server→client request channel, so `this.elicit()`
 * cannot round-trip inline. The server instead answers the ORIGINAL `tools/call`
 * with an `InputRequiredResult` (`resultType: "input_required"`) carrying an
 * `elicitation/create` entry in `inputRequests`, plus an opaque `requestState`.
 * The client re-issues `tools/call` with `inputResponses` + `requestState` and
 * the tool re-runs, this time resolving `elicit()` from the recorded response.
 */
@Tool({
  name: 'confirm',
  description: 'Asks the caller to confirm an action before reporting it as done',
  inputSchema,
  outputSchema,
})
export default class ConfirmTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    const result = await this.elicit(
      `Do you want to proceed with: ${input.action}?`,
      z.object({
        confirmed: z.boolean().describe('Confirm the action'),
      }),
    );

    return {
      action: input.action,
      confirmed: result.status === 'accept' && result.content?.confirmed === true,
    };
  }
}
