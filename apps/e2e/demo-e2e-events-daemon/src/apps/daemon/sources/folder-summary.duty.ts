import { AsyncProvider, Duty, EVENT_PUBLISHER, type DutyInterface, type EventPublisher } from '@frontmcp/sdk';
import { readdir } from '@frontmcp/utils';

import { dropFolder } from '../drop-folder';
import { folderSummary } from '../events/folder-summary.event';

/** The schedule of the summary: `SUMMARY_CRON`, else every day at 09:00. */
const summaryCron = process.env['SUMMARY_CRON'] ?? '0 9 * * *';

/** On its cron schedule, in one process of the machine, publishes how many files the drop folder holds. */
@Duty({ name: 'folder-summary', cron: summaryCron, scope: 'machine' })
class FolderSummaryDuty implements DutyInterface {
  /** Keep the publisher the duty publishes with. */
  constructor(private readonly events: EventPublisher) {}

  /** Count the files of the folder, and publish the count. */
  async run(): Promise<void> {
    const files = await readdir(dropFolder).catch(() => []);
    await this.events.publish(folderSummary, { fileCount: files.length, at: new Date().toISOString() });
  }
}

/** The duty, built with the publisher behind the EVENT_PUBLISHER token. */
export const folderSummaryDuty = AsyncProvider({
  provide: FolderSummaryDuty,
  name: 'folder-summary-duty',
  inject: () => [EVENT_PUBLISHER] as const,
  useFactory: (events) => new FolderSummaryDuty(events),
});
