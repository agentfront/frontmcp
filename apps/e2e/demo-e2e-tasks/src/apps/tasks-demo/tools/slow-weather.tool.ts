import { z } from 'zod';

import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  city: z.string().describe('City name'),
  delayMs: z.number().int().min(0).max(10_000).default(250).describe('Work duration in ms'),
};

const outputSchema = z.object({
  city: z.string(),
  temperatureF: z.number(),
  conditions: z.string(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

/**
 * Opt-in to task augmentation: clients MAY invoke this tool as a task, or call
 * it synchronously. Useful to demonstrate both code paths with the same tool.
 */
@Tool({
  name: 'slow-weather',
  description: 'Pretend-slow weather lookup — both synchronous and task-augmented callable.',
  inputSchema,
  outputSchema,
  execution: { taskSupport: 'optional' },
})
export default class SlowWeatherTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    await new Promise((r) => setTimeout(r, input.delayMs));
    return {
      city: input.city,
      temperatureF: 72,
      conditions: 'Partly cloudy',
    };
  }
}
