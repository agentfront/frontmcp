import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  text: z.string().describe('Text to summarize'),
};

const outputSchema = z.object({
  summary: z.string(),
  model: z.string().optional(),
});

type Input = z.output<z.ZodObject<typeof inputSchema>>;
type Output = z.output<typeof outputSchema>;

/**
 * Drives the sampling arm of MRTR.
 *
 * Under 2026-07-28 `sampling/createMessage` has no inline transport, so the
 * first call answers with an `InputRequiredResult` carrying a sampling request;
 * the client runs the completion and retries.
 */
@Tool({
  name: 'summarize',
  description: 'Summarizes text by asking the client LLM to complete it',
  inputSchema,
  outputSchema,
})
export default class SummarizeTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    const reply = await this.sample({
      messages: [{ role: 'user', content: { type: 'text', text: `Summarize: ${input.text}` } }],
      maxTokens: 100,
      systemPrompt: 'You are a concise summarizer.',
    });

    const content = reply.content as { text?: string } | undefined;
    return { summary: content?.text ?? '', ...(reply.model ? { model: reply.model } : {}) };
  }
}
