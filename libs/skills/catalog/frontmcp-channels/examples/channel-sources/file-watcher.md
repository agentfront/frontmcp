---
name: file-watcher
reference: channel-sources
level: intermediate
description: Watch files for changes and notify Claude Code in real-time
tags: [file-watcher, filesystem, logs, monitoring, real-time]
features:
  - File watcher source with declared paths and events
  - 'The `{ event, path }` payload of a file event'
  - State kept on the channel between file events
  - 'No `onConnect()`, so the framework watches the declared paths'
---

# File Watcher Channel

Watch files for changes and notify Claude Code in real-time

## Code

```typescript
// src/apps/monitoring/channels/log-watcher.channel.ts
import { basename } from 'node:path';

import { Channel, ChannelContext, type ChannelFileEvent, type ChannelNotification } from '@frontmcp/sdk';
import { readFile } from '@frontmcp/utils';

const MAX_CHARACTERS = 2000;

@Channel({
  name: 'log-watcher',
  description: 'Watches application logs and notifies on new lines',
  source: {
    type: 'file-watcher',
    paths: ['./logs/app.log', './logs/error.log'],
    events: ['create', 'change'],
  },
})
export class LogWatcherChannel extends ChannelContext {
  private readonly charactersRead = new Map<string, number>();

  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const { event, path } = payload as ChannelFileEvent;
    const fileName = basename(path);
    // A file created again at the same path is read from its start
    if (event === 'create') this.charactersRead.delete(path);
    const newText = await this.readNewText(path);
    return {
      content: `[${fileName}] ${newText || event}`,
      meta: { file: fileName, event },
    };
  }

  private async readNewText(path: string): Promise<string> {
    const content = await readFile(path);
    const alreadyRead = this.charactersRead.get(path) ?? 0;
    this.charactersRead.set(path, content.length);
    // A file that shrank was rotated: everything in it is new
    const newText = content.length < alreadyRead ? content : content.slice(alreadyRead);
    return newText.trim().slice(-MAX_CHARACTERS);
  }
}
```

The channel defines no `onConnect()`, so the framework watches both paths while the channel is connected, and calls
`onEvent()` with `{ event, path }` for each file that is created or changed. A connected file-watcher channel keeps one
instance, so `charactersRead` lasts from one file event to the next. The framework hands it one file event at a time,
in order, so a read never overlaps the one before it.

A channel that defines its own `onConnect()` is not watched by the framework: it watches by itself, as before 1.12
(see `channel-sources`).

## What This Demonstrates

- File watcher source with declared paths and events
- The `{ event, path }` payload of a file event
- State kept on the channel between file events
- No `onConnect()`, so the framework watches the declared paths

## Related

- See `channel-sources` for all source type documentation
