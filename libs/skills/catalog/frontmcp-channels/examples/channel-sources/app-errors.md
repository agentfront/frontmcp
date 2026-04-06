---
name: app-errors
reference: channel-sources
level: basic
description: Forward application errors to Claude Code via the in-process event bus
tags: [errors, app-event, debugging, monitoring]
features:
  - App event source with ChannelEventBus
  - Error severity classification
  - Stack trace forwarding
---

# Application Error Channel

Forward application errors to Claude Code via the in-process event bus

## Code

```typescript
// src/apps/monitoring/channels/error-alert.channel.ts
import { Channel, ChannelContext, ChannelNotification } from '@frontmcp/sdk';

@Channel({
  name: 'app-errors',
  description: 'Application error notifications for debugging',
  source: { type: 'app-event', event: 'error' },
})
export class ErrorAlertChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const error = payload as {
      message: string;
      stack?: string;
      code?: string;
      severity: 'warning' | 'error' | 'critical';
      source?: string;
    };

    const lines = [`[${error.severity.toUpperCase()}] ${error.message}`];
    if (error.code) lines.push(`Code: ${error.code}`);
    if (error.stack) lines.push(`Stack:\n${error.stack}`);

    return {
      content: lines.join('\n'),
      meta: {
        severity: error.severity,
        ...(error.code ? { code: error.code } : {}),
        ...(error.source ? { error_source: error.source } : {}),
      },
    };
  }
}

// Emit from anywhere in your application:
// scope.channelEventBus.emit('error', {
//   message: 'Database connection timeout',
//   severity: 'critical',
//   code: 'DB_TIMEOUT',
//   source: 'user-service',
//   stack: new Error().stack,
// });
```

## What This Demonstrates

- App event source with ChannelEventBus
- Error severity classification
- Stack trace forwarding

## Related

- See `channel-sources` for all source type documentation
