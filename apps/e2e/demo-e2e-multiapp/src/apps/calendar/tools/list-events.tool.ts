import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { eventStore } from '../data/event.store';

const inputSchema = {
  upcomingOnly: z.boolean().optional().default(false).describe('Only show upcoming events'),
};

const outputSchema = z.object({
  events: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      startTime: z.number(),
      endTime: z.number(),
      location: z.string().optional(),
    }),
  ),
  count: z.number(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'list-events',
  description: 'List all calendar events',
  inputSchema,
  outputSchema,
})
export default class ListEventsTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    const store = eventStore;
    const events = input.upcomingOnly ? store.getUpcoming() : store.getAll();

    return {
      events: events.map((e) => ({
        id: e.id,
        title: e.title,
        description: e.description,
        startTime: e.startTime,
        endTime: e.endTime,
        location: e.location,
      })),
      count: events.length,
    };
  }
}
