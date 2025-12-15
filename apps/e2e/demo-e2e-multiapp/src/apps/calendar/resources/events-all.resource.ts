import { Resource, ResourceContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { eventStore } from '../data/event.store';

const outputSchema = z.object({
  events: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      startTime: z.number(),
      endTime: z.number(),
      location: z.string().optional(),
      createdAt: z.number(),
    }),
  ),
  count: z.number(),
  upcoming: z.number(),
  app: z.string(),
});

type Output = z.infer<typeof outputSchema>;

@Resource({
  uri: 'calendar://events',
  name: 'All Events',
  description: 'All calendar events',
  mimeType: 'application/json',
})
export default class EventsAllResource extends ResourceContext<Record<string, never>, Output> {
  async execute(): Promise<Output> {
    const store = eventStore;
    const events = store.getAll();
    const upcomingEvents = store.getUpcoming();

    return {
      events: events.map((e) => ({
        id: e.id,
        title: e.title,
        description: e.description,
        startTime: e.startTime,
        endTime: e.endTime,
        location: e.location,
        createdAt: e.createdAt,
      })),
      count: events.length,
      upcoming: upcomingEvents.length,
      app: 'calendar',
    };
  }
}
