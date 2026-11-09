/**
 * Custom URL Forecast Tool - demonstrates servingMode: 'custom-url'
 *
 * The widget page lives at customWidgetUrl (a CDN); the ui:// resource frames it.
 */
import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  city: z.string().describe('City name'),
};

const outputSchema = z.object({ city: z.string(), low: z.number() }).strict();

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'custom-url-forecast',
  description: 'Forecast widget served from a CDN (servingMode custom-url).',
  inputSchema,
  outputSchema,
  ui: {
    servingMode: 'custom-url',
    customWidgetUrl: 'https://widgets.forecast.example/low.html',
    template: '',
  },
})
export default class CustomUrlForecastTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    return { city: input.city, low: 12 };
  }
}
