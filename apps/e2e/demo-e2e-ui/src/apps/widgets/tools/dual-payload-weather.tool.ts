/**
 * Dual Payload Weather Tool - demonstrates ui.htmlResponsePrefix
 *
 * A Claude client that renders no widget gets the page as a second, html-fenced text block.
 */
import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  city: z.string().describe('City name'),
};

const outputSchema = z.object({ city: z.string(), temperature: z.number() }).strict();

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'dual-payload-weather',
  description: 'Weather widget with a dual payload for clients that render no widget.',
  inputSchema,
  outputSchema,
  ui: {
    htmlResponsePrefix: 'Here is the weather dashboard',
    template: (ctx) => ctx.helpers.html`<div id="dual-weather">${ctx.output.city}: ${ctx.output.temperature}</div>`,
  },
})
export default class DualPayloadWeatherTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    return { city: input.city, temperature: 21 };
  }
}
