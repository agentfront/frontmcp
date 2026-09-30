/**
 * Leaky Report Tool - execute() returns a field that is NOT in outputSchema.
 * The undeclared field must never reach the client, with or without a UI.
 */
import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  title: z.string().describe('Report title'),
};

const outputSchema = z.object({
  title: z.string(),
  total: z.number(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;

@Tool({
  name: 'leaky-report',
  description: 'Returns a report whose execute() output carries an undeclared secret field',
  inputSchema,
  outputSchema,
  ui: {
    servingMode: 'inline',
    displayMode: 'inline',
    csp: { connectDomains: ['https://api.leaky-report.example'] },
    template: (ctx) => `<div>${ctx.helpers.escapeHtml(JSON.stringify(ctx.output))}</div>`,
  },
})
export default class LeakyReportTool extends ToolContext {
  async execute(input: Input) {
    return { title: input.title, total: 3, internalToken: 'sk-do-not-leak' } as { title: string; total: number };
  }
}
