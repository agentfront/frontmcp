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

The SDK keeps a per-channel ring buffer of the last `maxEvents` notifications. Replay is delivered via `ChannelInstance.replayBufferedEvents(sessionId)` (defined in `libs/sdk/src/channel/channel.instance.ts`). That method lives on the **channel instance**, not on `ChannelContext`, so you cannot call `this.replayBufferedEvents(...)` from within `onEvent`/`onConnect`. The runtime invokes it for you when a new session subscribes; you only need to author the replay logic if you want to trigger it manually from outside the channel (e.g. in a custom session-connect hook that resolves the `ChannelInstance` from the channel registry).

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
3. When a new Claude Code session subscribes, the runtime calls `ChannelInstance.replayBufferedEvents(sessionId)` for every replay-enabled channel.
4. Each buffered notification is sent to the new session with `replayed: "true"` injected into its meta.
5. The persistent-store pattern above is independent of the in-memory buffer: you replay from Redis on `onConnect()`, while `replay.enabled: true` continues to handle late-joining sessions for the lifetime of the process.

## What This Demonstrates

- Replay configuration with `maxEvents` cap
- In-memory ring buffer for event storage
- Where `replayBufferedEvents` actually lives (on `ChannelInstance`, not on `ChannelContext`)
- Persistent store pattern with `onConnect` and a user-defined Redis provider

## Related

- See `channel-sources` for all source type documentation
