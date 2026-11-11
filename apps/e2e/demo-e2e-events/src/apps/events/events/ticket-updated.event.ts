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
let loading: Promise<TicketChange[]> | undefined;
let saving: Promise<void> = Promise.resolve();

/** Read the changes a previous server stored, and put them before any recorded since. */
async function loadStoredChanges(file: string): Promise<TicketChange[]> {
  const stored = await readFile(file).catch(() => '[]');
  ticketChanges.unshift(...(JSON.parse(stored) as TicketChange[]));
  return ticketChanges;
}

/** The ticket changes so far, in order: every caller waits for the one load of the stored changes. */
function allTicketChanges(): Promise<TicketChange[]> {
  if (!ticketsFile) return Promise.resolve(ticketChanges);
  loading ??= loadStoredChanges(ticketsFile).catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

/** Record a change of a ticket, and answer how many were recorded. */
export async function recordTicketChange(change: TicketChange): Promise<number> {
  const changes = await allTicketChanges();
  changes.push(change);
  const count = changes.length;
  if (ticketsFile) await saveChanges(ticketsFile);
  return count;
}

/** Write the changes after the write in progress, whether it failed or not: the last write holds every change. */
function saveChanges(file: string): Promise<void> {
  const write = saving.catch(() => undefined).then(() => writeFile(file, JSON.stringify(ticketChanges)));
  saving = write;
  return write;
}

/** Fires when a ticket changes. It is read from an upstream that can replay, so its cursor is the upstream's. */
export const ticketUpdated = event({
  name: 'ticket.updated',
  description: 'Fires when a ticket changes',
  inputSchema: { queue: z.string().optional() },
  payloadSchema: { ticketId: z.string(), queue: z.string() },
  /** The changes after `cursor` in the asked queue, at most `limits.maxEvents`; a `null` cursor gives the position. */
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
