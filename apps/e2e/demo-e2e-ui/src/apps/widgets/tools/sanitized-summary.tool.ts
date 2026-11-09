/**
 * Sanitized Summary Tool - renders HTML the tool returns, sanitized by `ui.contentSecurity`:
 * scripts, event handlers and unsafe links are removed, the rest of the markup stays.
 */
import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  summaryHtml: z.string().describe('HTML summary to display'),
};

const outputSchema = z.object({ summaryHtml: z.string() });

type Input = z.infer<z.ZodObject<typeof inputSchema>>;

@Tool({
  name: 'sanitized-summary',
  description: 'Display an HTML summary with scripts, handlers and unsafe links removed',
  inputSchema,
  outputSchema,
  ui: {
    servingMode: 'inline',
    escapeStringResults: false,
    contentSecurity: {},
    template: (ctx) => `<section class="summary">${(ctx.output as { summaryHtml: string }).summaryHtml}</section>`,
  },
})
export default class SanitizedSummaryTool extends ToolContext {
  async execute(input: Input) {
    return { summaryHtml: input.summaryHtml };
  }
}
