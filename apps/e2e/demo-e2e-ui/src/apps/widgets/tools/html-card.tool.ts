import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const inputSchema = {
  title: z.string().describe('Card title'),
  content: z.string().describe('Card content'),
  footer: z.string().optional().describe('Optional card footer'),
};

const outputSchema = z.object({
  uiType: z.literal('html'),
  html: z.string(),
  title: z.string(),
});

type Input = z.input<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'html-card',
  description: 'Generate an HTML card component',
  inputSchema,
  outputSchema,
  ui: {
    servingMode: 'auto',
    displayMode: 'inline',
    widgetDescription: 'Displays a styled HTML card with title, content, and optional footer.',
    template: (ctx) => {
      // title comes from output, content/footer come from input
      const { title } = ctx.output as unknown as { title: string };
      const { content, footer } = ctx.input as unknown as { content: string; footer?: string };
      const escapeHtml = ctx.helpers.escapeHtml;

      return `
        <div style="border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; max-width: 400px; font-family: sans-serif; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <h2 style="margin: 0 0 12px 0; color: #333;">${escapeHtml(title)}</h2>
          <p style="margin: 0 0 12px 0; color: #666;">${escapeHtml(content)}</p>
          ${
            footer
              ? `<footer style="border-top: 1px solid #eee; padding-top: 12px; color: #888; font-size: 0.9em;">${escapeHtml(
                  footer,
                )}</footer>`
              : ''
          }
        </div>
      `;
    },
  },
})
export default class HtmlCardTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    return {
      uiType: 'html',
      html: `<div class="card">${escapeHtml(input.title)}</div>`,
      title: input.title,
    };
  }
}
