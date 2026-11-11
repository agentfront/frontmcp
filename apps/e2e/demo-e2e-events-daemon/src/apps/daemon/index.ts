import { App } from '@frontmcp/sdk';

import { fileDropped } from './events/file-dropped.event';
import { folderSummary } from './events/folder-summary.event';
import { dropFolderWatcher } from './sources/drop-folder.worker';
import { folderSummaryDuty } from './sources/folder-summary.duty';

/** The events, the worker and the duty of the daemon. */
@App({
  name: 'daemon',
  description: 'A local daemon: a worker that watches a folder and a scheduled duty, both publishing events',
  events: [fileDropped, folderSummary],
  providers: [dropFolderWatcher, folderSummaryDuty],
})
export class DaemonApp {}
