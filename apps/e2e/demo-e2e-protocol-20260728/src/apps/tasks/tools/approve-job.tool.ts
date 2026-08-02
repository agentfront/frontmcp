import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  change: z.string().describe('The change awaiting approval'),
};

const outputSchema = z.object({
  change: z.string(),
  approved: z.boolean(),
});

type Input = z.output<z.ZodObject<typeof inputSchema>>;
type Output = z.output<typeof outputSchema>;

/**
 * A human-in-the-loop task: it pauses mid-flight for approval.
 *
 * The background run raises an input request, which parks the task in
 * `input_required`. The client sees the pending `inputRequests` on `tasks/get`
 * and answers with `tasks/update`, which resumes execution.
 */
@Tool({
  name: 'approve-job',
  description: 'Waits for human approval before reporting the change as applied',
  inputSchema,
  outputSchema,
  execution: { taskSupport: 'optional' },
})
export default class ApproveJobTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    const decision = await this.elicit(
      `Approve change: ${input.change}?`,
      z.object({ approved: z.boolean().describe('Approve the change') }),
    );

    return {
      change: input.change,
      approved: decision.status === 'accept' && decision.content?.approved === true,
    };
  }
}
