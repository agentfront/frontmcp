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

import { dropFolder } from '../drop-folder';
import { fileDropped } from '../events/file-dropped.event';

/** Watches the drop folder for as long as the server runs, and publishes file.dropped for each new or changed file. */
@Worker({ name: 'drop-folder-watcher', scope: 'machine' })
class DropFolderWatcher implements WorkerInterface {
  /** Keep the publisher the worker publishes with. */
  constructor(private readonly events: EventPublisher) {}

  /** Publish each change until the server stops the worker. */
  async run({ signal }: WorkerRunContext): Promise<void> {
    for await (const { type, path: filePath } of watchFiles(dropFolder, { events: ['add', 'change'], signal })) {
      await this.events.publish(fileDropped, { name: path.basename(filePath), change: type as 'add' | 'change' });
    }
  }
}

/** The worker, built with the publisher behind the EVENT_PUBLISHER token: `tsx` emits no constructor types. */
export const dropFolderWatcher = AsyncProvider({
  provide: DropFolderWatcher,
  name: 'drop-folder-watcher',
  inject: () => [EVENT_PUBLISHER] as const,
  useFactory: (events) => new DropFolderWatcher(events),
});
