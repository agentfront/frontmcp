import * as os from 'node:os';
import * as path from 'node:path';

import { Channel, ChannelContext, type ChannelFileEvent, type ChannelNotification } from '@frontmcp/sdk';

/** The folder the channel watches: `CHANNELS_WATCH_DIR`, else `demo-e2e-channels-watch` in the temporary directory. */
const watchedFolder = process.env['CHANNELS_WATCH_DIR'] ?? path.join(os.tmpdir(), 'demo-e2e-channels-watch');

/** Tells a session about each file that is created or changed in the watched folder. */
@Channel({
  name: 'file-watcher',
  description: 'Files created or changed in the watched folder',
  source: { type: 'file-watcher', paths: [watchedFolder], events: ['create', 'change'] },
})
export class FileWatcherChannel extends ChannelContext {
  /** Names the file and what happened to it. */
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const { event, path: filePath } = payload as ChannelFileEvent;
    const fileName = path.basename(filePath);
    return { content: `[${event}] ${fileName}`, meta: { file: fileName, event_type: event } };
  }
}
