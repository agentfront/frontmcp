import { z } from '@frontmcp/lazy-zod';
import { event } from '@frontmcp/sdk';

/** The tickets that changed, in order: the upstream a client replays from with the cursor `check()` returns. */
export const ticketChanges: Array<{ ticketId: string; queue: string }> = [];

/** Fires when a ticket changes. It is read from an upstream that can replay, so its cursor is the upstream's. */
export const ticketUpdated = event({
  name: 'ticket.updated',
  description: 'Fires when a ticket changes',
  inputSchema: { queue: z.string().optional() },
  payloadSchema: { ticketId: z.string(), queue: z.string() },
  check(args, cursor, limits) {
    if (cursor === null) return { events: [], cursor: String(ticketChanges.length) };
    const position = Number(cursor);
    const batch = ticketChanges.slice(position, position + (limits?.maxEvents ?? ticketChanges.length));
    const wanted = batch.filter((change) => args.queue === undefined || args.queue === change.queue);
    return {
      events: wanted.map((change) => ({ data: change })),
      cursor: String(position + batch.length),
      hasMore: position + batch.length < ticketChanges.length,
    };
  },
});
