/**
 * Custom URI Tool - advertises its own ui.resourceUri; resources/read must serve it.
 */
import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  label: z.string().describe('Label to show'),
};

type Input = z.infer<z.ZodObject<typeof inputSchema>>;

@Tool({
  name: 'custom-uri-widget',
  description: 'Tool whose widget lives at a custom ui:// URI',
  inputSchema,
  ui: {
    servingMode: 'static',
    displayMode: 'inline',
    resourceUri: 'ui://acme/custom-dashboard',
    template: (ctx) => `<div id="custom-uri-widget">${ctx.helpers.escapeHtml(String(ctx.output ?? ''))}</div>`,
  },
})
export default class CustomUriTool extends ToolContext {
  async execute(input: Input) {
    return input.label;
  }
}
