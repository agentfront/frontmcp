/**
 * Simulated file watcher channel.
 * Uses the service source type to simulate file watching via onConnect().
 * In production, you'd use fs.watch — here we use a simulated push for testing.
 */

import { Channel, ChannelContext } from '@frontmcp/sdk';
import type { ChannelNotification } from '@frontmcp/sdk';

/** Simulated file events for testing */
export const fileEventQueue: Array<{ file: string; event: string; content?: string }> = [];
let pushFileEventRef: ((payload: unknown) => void) | undefined;

export function simulateFileEvent(file: string, event: string, content?: string): void {
  if (pushFileEventRef) {
    pushFileEventRef({ file, event, content });
  } else {
    fileEventQueue.push({ file, event, content });
  }
}

@Channel({
  name: 'file-watcher',
  description: 'Watches files for changes (simulated for testing)',
  source: { type: 'file-watcher', paths: ['./logs/app.log'], events: ['change', 'create'] },
})
export class FileWatcherChannel extends ChannelContext {
  async onConnect(): Promise<void> {
    this.logger.info('File watcher: connecting...');
    pushFileEventRef = (payload: unknown) => this.pushIncoming(payload);

    // Process queued events
    while (fileEventQueue.length > 0) {
      const event = fileEventQueue.shift()!;
      this.pushIncoming(event);
    }

    this.logger.info('File watcher: connected');
  }

  async onDisconnect(): Promise<void> {
    pushFileEventRef = undefined;
    this.logger.info('File watcher: disconnected');
  }

  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const event = payload as { file: string; event: string; content?: string };
    const fileName = event.file.split('/').pop() ?? event.file;
    return {
      content: `[${event.event}] ${fileName}${event.content ? `: ${event.content}` : ''}`,
      meta: { file: fileName, event_type: event.event },
    };
  }
}
