/**
 * Direct URL Forecast Tool - demonstrates servingMode: 'direct-url'
 *
 * The page is compiled at startup and served on GET /widgets/forecast; the ui:// resource frames it.
 */
import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  city: z.string().describe('City name'),
};

const outputSchema = z.object({ city: z.string(), high: z.number() }).strict();

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'direct-url-forecast',
  description: 'Forecast widget served from a route of the server (servingMode direct-url).',
  inputSchema,
  outputSchema,
  ui: {
    servingMode: 'direct-url',
    directPath: '/widgets/forecast',
    csp: { connectDomains: ['https://api.forecast.example'] },
    template: `<div id="forecast-widget">Forecast</div>
<script>
  window.addEventListener('tool:result', function (event) {
    var data = event.detail.structuredContent;
    document.getElementById('forecast-widget').textContent = data.city + ': ' + data.high;
  });
</script>`,
  },
})
export default class DirectUrlForecastTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    return { city: input.city, high: 24 };
  }
}
