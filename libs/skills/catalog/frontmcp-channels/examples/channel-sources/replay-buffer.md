---
name: replay-buffer
reference: channel-sources
level: advanced
description: Buffer channel events so Claude Code receives them when it connects, even if events occurred while offline
tags: [replay, buffer, persistence, offline, reconnect]
features:
  - Replay configuration with maxEvents cap
  - In-memory ring buffer for event storage
  - Replay on session connect
  - Persistent store pattern with onConnect
---

# Replay Buffer Pattern

Buffer channel events so Claude Code receives them when it connects, even if events occurred while offline.

## Basic Replay (In-Memory)

```typescript
@Channel({
  name: 'ci-alerts',
  description: 'CI/CD alerts with replay for offline sessions',
  source: { type: 'webhook', path: '/hooks/ci' },
  replay: {
    enabled: true,
    maxEvents: 100, // Ring buffer, oldest events evicted
  },
})
class CIAlertChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const { body } = payload as { body: { pipeline: string; status: string } };
    return {
      content: `CI: ${body.pipeline} ${body.status}`,
      meta: { pipeline: body.pipeline },
    };
  }
}
```

The SDK keeps a per-channel ring buffer of the last `maxEvents` notifications. Replay is delivered via `ChannelInstance.replayBufferedEvents(sessionId)` (defined in `libs/sdk/src/channel/channel.instance.ts:223`). That method lives on the **channel instance**, not on `ChannelContext`, so you cannot call `this.replayBufferedEvents(...)` from within `onEvent`/`onConnect`.

Replay is **not** triggered automatically when a new session subscribes — there is no caller of `replayBufferedEvents` inside the SDK today. To deliver buffered events, expose a tool that resolves the channel from the registry and triggers replay explicitly (Claude Code can call this on demand, or your application can call it from a custom hook):

```typescript
// src/apps/alerts/tools/replay-ci-alerts.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';
import type ChannelRegistry from '@frontmcp/sdk/channel/channel.registry';

@Tool({
  name: 'replay-ci-alerts',
  description: 'Replay buffered CI alerts to the current session.',
  inputSchema: {
    channel_name: z.string().default('ci-alerts'),
  },
})
export class ReplayCIAlertsTool extends ToolContext {
  async execute(input) {
    // Resolve the channel registry off scope (same cast pattern as ChannelReplyTool)
    const scope = this.scope as unknown as { channels?: ChannelRegistry };
    const registry = scope.channels;
    if (!registry) {
      return { content: [{ type: 'text', text: 'Channels are not enabled on this server.' }], isError: true };
    }

    const channel = registry.findByName(input.channel_name);
    if (!channel) {
      return { content: [{ type: 'text', text: `Channel "${input.channel_name}" not found.` }], isError: true };
    }

    const sessionId = this.context.sessionId;
    const replayed = channel.replayBufferedEvents(sessionId);
    return { content: [{ type: 'text', text: `Replayed ${replayed} buffered event(s).` }] };
  }
}
```

Replayed events arrive at Claude Code with `replayed: "true"` in their meta so the model can distinguish them from live events.

## Persistent Store Pattern (Redis)

The in-memory ring buffer does not survive process restarts. To persist events across restarts, push events into Redis and rehydrate on `onConnect()`. Inject a Redis-backed provider the same way the demo apps do (`apps/demo/src/apps/employee-time/providers/redis.provider.ts`):

```typescript
// src/apps/alerts/providers/alerts-redis.provider.ts
import Redis, { Redis as RedisClient } from 'ioredis';

import { AsyncProvider, ProviderScope } from '@frontmcp/sdk';

export default class AlertsRedisProvider {
  readonly client: RedisClient;

  constructor() {
    this.client = new Redis({ host: 'localhost', port: 6379 });
  }
}

export const createAlertsRedisProvider = AsyncProvider({
  provide: AlertsRedisProvider,
  name: 'AlertsRedisProvider',
  scope: ProviderScope.GLOBAL,
  inject: () => [] as const,
  useFactory: async () => new AlertsRedisProvider(),
});
```

Resolve the provider inside the channel via `this.get(AlertsRedisProvider)` and use it to load + record events:

```typescript
// src/apps/alerts/channels/persistent-alert.channel.ts
import { Channel, ChannelContext, type ChannelNotification } from '@frontmcp/sdk';

import AlertsRedisProvider from '../providers/alerts-redis.provider';

@Channel({
  name: 'alerts',
  description: 'Persistent alerts with Redis-backed replay',
  source: { type: 'service', service: 'alert-store' },
  replay: { enabled: true, maxEvents: 500 },
})
export class PersistentAlertChannel extends ChannelContext {
  async onConnect(): Promise<void> {
    const redis = this.get(AlertsRedisProvider).client;

    // Replay history from Redis into the channel pipeline
    const stored = await redis.lrange('channel:alerts:buffer', 0, -1);
    for (const raw of stored) {
      const event = JSON.parse(raw);
      this.pushIncoming(event);
    }

    // Subscribe to new events and persist them as they arrive
    const subscriber = redis.duplicate();
    await subscriber.subscribe('channel:alerts');
    subscriber.on('message', async (_channel, message) => {
      await redis.rpush('channel:alerts:buffer', message);
      await redis.ltrim('channel:alerts:buffer', -500, -1);
      this.pushIncoming(JSON.parse(message));
    });

    this.logger.info('Alert store connected, history loaded');
  }

  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const alert = payload as { title: string; severity: string; timestamp: string };
    return {
      content: `[${alert.severity}] ${alert.title}`,
      meta: { severity: alert.severity, timestamp: alert.timestamp },
    };
  }
}
```

Register the provider on the app so DI can resolve it:

```typescript
@App({
  name: 'Alerts',
  channels: [PersistentAlertChannel],
  providers: [createAlertsRedisProvider],
})
class AlertsApp {}
```

## How Replay Works

1. Events arrive via any source -> `onEvent()` transforms them -> notification pushed to live sessions.
2. If `replay.enabled`, each pushed notification is also stored in the channel's ring buffer (FIFO, capped at `maxEvents`).
3. Replay is **user-triggered**: call `ChannelInstance.replayBufferedEvents(sessionId)` yourself — typically from a tool (see `ReplayCIAlertsTool` above) or from a custom session lifecycle hook in your app.
4. Each buffered notification is sent to the target session with `replayed: "true"` injected into its meta.
5. The persistent-store pattern shown above is independent of the in-memory buffer: you replay from Redis on `onConnect()` (which fires once when the channel boots), while the in-memory ring buffer is what `replayBufferedEvents` reads from when invoked.

## What This Demonstrates

- Replay configuration with `maxEvents` cap
- In-memory ring buffer for event storage
- Where `replayBufferedEvents` actually lives (on `ChannelInstance`, not on `ChannelContext`)
- Persistent store pattern with `onConnect` and a user-defined Redis provider

## Related

- See `channel-sources` for all source type documentation
