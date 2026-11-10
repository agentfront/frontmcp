import * as os from 'node:os';
import * as path from 'node:path';

import {
  AsyncProvider,
  EVENT_PUBLISHER,
  Worker,
  type EventPublisher,
  type WorkerInterface,
  type WorkerRunContext,
} from '@frontmcp/sdk';
import { watchFiles } from '@frontmcp/utils';

import { fileAdded } from '../events/file-added.event';

const inboxDirectory = process.env['EVENTS_INBOX_DIR'] ?? path.join(os.tmpdir(), 'demo-e2e-events-inbox');

/** Publishes file.added for each file that appears in the inbox folder. */
@Worker({ name: 'inbox-watcher', scope: 'process' })
class InboxWatcher implements WorkerInterface {
  constructor(private readonly events: EventPublisher) {}

  async run({ signal }: WorkerRunContext): Promise<void> {
    for await (const added of watchFiles(inboxDirectory, { events: ['add'], signal })) {
      await this.events.publish(fileAdded, { name: path.basename(added.path) });
    }
  }
}

/** The worker, built with the publisher behind the EVENT_PUBLISHER token. */
export const inboxWatcher = AsyncProvider({
  provide: InboxWatcher,
  name: 'inbox-watcher',
  inject: () => [EVENT_PUBLISHER] as const,
  useFactory: (events) => new InboxWatcher(events),
});
