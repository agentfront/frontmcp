/**
 * Hydrated Counter Tool - a `{ file }` React widget rendered on the server and hydrated in the page
 * (`ui.hydrate`): the page shows the counter before its script runs, and the button works after.
 */
import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  label: z.string().describe('Counter label'),
  start: z.number().describe('Starting count'),
};

const outputSchema = z.object({ label: z.string(), start: z.number() });

type Input = z.infer<z.ZodObject<typeof inputSchema>>;

@Tool({
  name: 'hydrated-counter',
  description: 'Show a counter rendered on the server and hydrated in the page',
  inputSchema,
  outputSchema,
  ui: {
    servingMode: 'inline',
    hydrate: true,
    template: { file: 'apps/e2e/demo-e2e-ui/src/apps/widgets/tools/counter.ui.tsx' },
  },
})
export default class HydratedCounterTool extends ToolContext {
  async execute(input: Input) {
    return { label: input.label, start: input.start };
  }
}
