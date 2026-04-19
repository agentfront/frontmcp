/**
 * React Weather Tool - demonstrates FileSource UI with esbuild bundling.
 *
 * Uses `template: { file: '...' }` which bundles the React component at
 * server startup via esbuild, producing inline HTML with esm.sh import maps.
 */
import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  location: z.string().describe('City name'),
};

const outputSchema = z.object({
  location: z.string(),
  temperature: z.number(),
  units: z.enum(['celsius', 'fahrenheit']),
  conditions: z.string(),
  icon: z.string(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'react-weather',
  description: 'Get weather with a React widget UI (FileSource bundled).',
  inputSchema,
  outputSchema,
  ui: {
    servingMode: 'static',
    displayMode: 'inline',
    uiType: 'react',
    widgetDescription: 'Weather widget with Card and Badge components from @frontmcp/ui.',
    template: { file: 'apps/e2e/demo-e2e-ui/src/apps/widgets/tools/react-weather.ui.tsx' },
  },
})
export default class ReactWeatherTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    const data: Record<string, Partial<Output>> = {
      london: { temperature: 14, conditions: 'rainy', icon: 'rainy' },
      tokyo: { temperature: 25, conditions: 'cloudy', icon: 'cloudy' },
    };
    const match = data[input.location.toLowerCase()];
    return {
      location: input.location,
      temperature: match?.temperature ?? 20,
      units: 'celsius',
      conditions: match?.conditions ?? 'sunny',
      icon: match?.icon ?? 'sunny',
    };
  }
}
