---
name: file-watcher
reference: channel-sources
level: intermediate
description: Watch files for changes and notify Claude Code in real-time
tags: [file-watcher, filesystem, logs, monitoring, real-time]
features:
  - File watcher source type with glob patterns
  - onConnect lifecycle for starting the watcher
  - pushIncoming for streaming file events
  - Log file monitoring example
---

# File Watcher Channel

Watch files for changes and notify Claude Code in real-time

## Code

```typescript
// src/apps/monitoring/channels/log-watcher.channel.ts
import { Channel, ChannelContext } from '@frontmcp/sdk';
import type { ChannelNotification } from '@frontmcp/sdk';
import { watch } from 'node:fs';
import { readFile } from '@frontmcp/utils';

@Channel({
  name: 'log-watcher',
  description: 'Watches application logs and notifies on new errors',
  source: {
    type: 'file-watcher',
    paths: ['./logs/app.log', './logs/error.log'],
    events: ['change'],
  },
})
export class LogWatcherChannel extends ChannelContext {
  private watchers: ReturnType<typeof watch>[] = [];
  private lastSize = new Map<string, number>();

  async onConnect(): Promise<void> {
    const paths = (this.metadata.source as { paths: string[] }).paths;

    for (const filePath of paths) {
      try {
        const watcher = watch(filePath, async (eventType) => {
          if (eventType === 'change') {
            const newContent = await this.readNewLines(filePath);
            if (newContent) {
              this.pushIncoming({ file: filePath, content: newContent });
            }
          }
        });
        this.watchers.push(watcher);
        this.logger.info(`Watching: ${filePath}`);
      } catch (err) {
        this.logger.warn(`Cannot watch ${filePath}: ${err}`);
      }
    }
  }

  async onDisconnect(): Promise<void> {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
  }

  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const event = payload as { file: string; content: string };
    const fileName = event.file.split('/').pop() ?? event.file;
    return {
      content: `[${fileName}] ${event.content}`,
      meta: { file: fileName },
    };
  }

  private async readNewLines(filePath: string): Promise<string | null> {
    try {
      const content = await readFile(filePath);
      const prevSize = this.lastSize.get(filePath) ?? 0;
      if (content.length <= prevSize) return null;
      const newContent = content.slice(prevSize).trim();
      this.lastSize.set(filePath, content.length);
      return newContent || null;
    } catch {
      return null;
    }
  }
}
```

## What This Demonstrates

- File watcher source type with glob patterns
- onConnect lifecycle for starting the watcher
- pushIncoming for streaming file events
- Log file monitoring example

## Related

- See `channel-sources` for all source type documentation
