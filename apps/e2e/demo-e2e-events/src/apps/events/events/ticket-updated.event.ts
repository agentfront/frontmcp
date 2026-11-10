import { z } from '@frontmcp/lazy-zod';
import { event } from '@frontmcp/sdk';
import { readFile, writeFile } from '@frontmcp/utils';

interface TicketChange {
  ticketId: string;
  queue: string;
}

/** A test that restarts the server keeps the upstream in this file, so a cursor means the same after the restart. */
const ticketsFile = process.env['EVENTS_TICKETS_FILE'];
const ticketChanges: TicketChange[] = [];
let isLoaded = false;

/** The ticket changes so far, in order: the upstream a client replays from with the cursor `check()` returns. */
async function allTicketChanges(): Promise<TicketChange[]> {
  if (isLoaded || !ticketsFile) return ticketChanges;
  isLoaded = true;
  const stored = await readFile(ticketsFile).catch(() => '[]');
  ticketChanges.push(...(JSON.parse(stored) as TicketChange[]));
  return ticketChanges;
}

/** Record a change of a ticket, and answer how many were recorded. */
export async function recordTicketChange(change: TicketChange): Promise<number> {
  const changes = await allTicketChanges();
  changes.push(change);
  if (ticketsFile) await writeFile(ticketsFile, JSON.stringify(changes));
  return changes.length;
}

/** Fires when a ticket changes. It is read from an upstream that can replay, so its cursor is the upstream's. */
export const ticketUpdated = event({
  name: 'ticket.updated',
  description: 'Fires when a ticket changes',
  inputSchema: { queue: z.string().optional() },
  payloadSchema: { ticketId: z.string(), queue: z.string() },
  async check(args, cursor, limits) {
    const changes = await allTicketChanges();
    if (cursor === null) return { events: [], cursor: String(changes.length) };
    const position = Number(cursor);
    const batch = changes.slice(position, position + (limits?.maxEvents ?? changes.length));
    const wanted = batch.filter((change) => args.queue === undefined || args.queue === change.queue);
    return {
      events: wanted.map((change) => ({ data: change })),
      cursor: String(position + batch.length),
      hasMore: position + batch.length < changes.length,
    };
  },
});
