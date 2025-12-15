import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { eventStore } from '../data/event.store';

const inputSchema = z
  .object({
    title: z.string().min(1).describe('Event title'),
    description: z.string().optional().default('').describe('Event description'),
    startTime: z.number().describe('Event start time (Unix timestamp in ms)'),
    endTime: z.number().describe('Event end time (Unix timestamp in ms)'),
    location: z.string().optional().describe('Event location'),
  })
  .strict();

const outputSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  startTime: z.number(),
  endTime: z.number(),
  location: z.string().optional(),
  createdAt: z.number(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'create-event',
  description: 'Create a new calendar event',
  inputSchema,
  outputSchema,
})
export default class CreateEventTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    const store = eventStore;
    const event = store.create(input.title, input.description, input.startTime, input.endTime, input.location);

    return {
      id: event.id,
      title: event.title,
      description: event.description,
      startTime: event.startTime,
      endTime: event.endTime,
      location: event.location,
      createdAt: event.createdAt,
    };
  }
}
