/**
 * The upstream of the `ticket.updated` event in the e2e app: the changes a restart test stores in a file are loaded
 * once, before any change recorded or read, whoever asks first.
 */
import * as os from 'node:os';
import * as path from 'node:path';

import { mkdir, mkdtemp, readFile, rm, writeFile } from '@frontmcp/utils';

type TicketModule = typeof import('../src/apps/events/events/ticket-updated.event');

describe('the ticket changes of the e2e app', () => {
  let directory: string;
  let ticketsFile: string;
  const previous = process.env['EVENTS_TICKETS_FILE'];

  /** The event module, loaded fresh with the tickets file of this test. */
  function freshModule(): TicketModule {
    let loaded: TicketModule | undefined;
    jest.isolateModules(() => {
      loaded = jest.requireActual<TicketModule>('../src/apps/events/events/ticket-updated.event');
    });
    if (!loaded) throw new Error('the ticket module did not load');
    return loaded;
  }

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'demo-e2e-events-tickets-'));
    ticketsFile = path.join(directory, 'tickets.json');
    process.env['EVENTS_TICKETS_FILE'] = ticketsFile;
  });

  afterEach(async () => {
    if (previous === undefined) delete process.env['EVENTS_TICKETS_FILE'];
    else process.env['EVENTS_TICKETS_FILE'] = previous;
    await rm(directory, { recursive: true, force: true });
  });

  it('keeps the stored changes first when two changes are recorded while they load', async () => {
    await writeFile(ticketsFile, JSON.stringify([{ ticketId: 't-stored', queue: 'billing' }]));
    const { recordTicketChange } = freshModule();

    const counts = await Promise.all([
      recordTicketChange({ ticketId: 't-1', queue: 'billing' }),
      recordTicketChange({ ticketId: 't-2', queue: 'billing' }),
    ]);

    expect(counts).toEqual([2, 3]);
    const stored = JSON.parse(await readFile(ticketsFile)) as Array<{ ticketId: string }>;
    expect(stored.map((change) => change.ticketId)).toEqual(['t-stored', 't-1', 't-2']);
  });

  it('saves the next change after a write that failed', async () => {
    await writeFile(ticketsFile, '[]');
    const { recordTicketChange } = freshModule();
    await recordTicketChange({ ticketId: 't-1', queue: 'billing' });
    await rm(ticketsFile, { force: true });
    await mkdir(ticketsFile);

    await expect(recordTicketChange({ ticketId: 't-2', queue: 'billing' })).rejects.toThrow();
    await rm(ticketsFile, { recursive: true, force: true });
    await recordTicketChange({ ticketId: 't-3', queue: 'billing' });

    const stored = JSON.parse(await readFile(ticketsFile)) as Array<{ ticketId: string }>;
    expect(stored.map((change) => change.ticketId)).toEqual(['t-1', 't-2', 't-3']);
  });

  it('loads the stored changes again after a file it could not parse', async () => {
    await writeFile(ticketsFile, 'not json');
    const { recordTicketChange } = freshModule();

    await expect(recordTicketChange({ ticketId: 't-1', queue: 'billing' })).rejects.toThrow();
    await writeFile(ticketsFile, JSON.stringify([{ ticketId: 't-stored', queue: 'billing' }]));

    await expect(recordTicketChange({ ticketId: 't-2', queue: 'billing' })).resolves.toBe(2);
  });
});
