import { Resource, ResourceContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { notificationLogStore, NotificationLogEntry } from '../data/notification-log.store';

const outputSchema = z.object({
  notifications: z.array(
    z.object({
      id: z.string(),
      timestamp: z.number(),
      type: z.enum(['resource_change', 'progress', 'message', 'tools_changed', 'prompts_changed']),
      details: z.record(z.string(), z.unknown()),
    }),
  ),
  count: z.number(),
  types: z.record(z.string(), z.number()),
});

type Output = z.infer<typeof outputSchema>;

@Resource({
  uri: 'notifications://log',
  name: 'Notification Log',
  description: 'History of all notifications sent by the server',
  mimeType: 'application/json',
})
export default class NotificationLogResource extends ResourceContext<Record<string, never>, Output> {
  async execute(): Promise<Output> {
    const entries = notificationLogStore.getAll();

    // Count notifications by type
    const types: Record<string, number> = {};
    for (const entry of entries) {
      types[entry.type] = (types[entry.type] ?? 0) + 1;
    }

    return {
      notifications: entries.map((e: NotificationLogEntry) => ({
        id: e.id,
        timestamp: e.timestamp,
        type: e.type,
        details: e.details,
      })),
      count: entries.length,
      types,
    };
  }
}
