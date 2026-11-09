/**
 * Bundled Note Tools - demonstrate ui.bundlingMode
 *
 * 'static' builds the page once at startup; 'dynamic' renders it with each call's data.
 */
import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  text: z.string().describe('Note text'),
};

const outputSchema = z.object({ text: z.string() }).strict();

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'bundled-static-note',
  description: 'Note widget built once at startup (bundlingMode static).',
  inputSchema,
  outputSchema,
  ui: { bundlingMode: 'static', template: '<div id="static-note">note</div>' },
})
export class BundledStaticNoteTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    return { text: input.text };
  }
}

@Tool({
  name: 'bundled-dynamic-note',
  description: 'Note widget rendered for each call (bundlingMode dynamic).',
  inputSchema,
  outputSchema,
  ui: {
    bundlingMode: 'dynamic',
    template: (ctx) => ctx.helpers.html`<div id="dynamic-note">${ctx.output.text}</div>`,
  },
})
export class BundledDynamicNoteTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    return { text: input.text };
  }
}
