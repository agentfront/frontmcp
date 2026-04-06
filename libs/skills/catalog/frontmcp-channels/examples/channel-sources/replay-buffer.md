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

Buffer channel events so Claude Code receives them when it connects, even if events occurred while offline

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

Events are automatically buffered. When a Claude Code session connects, call `replayBufferedEvents(sessionId)` to send all buffered events. Replayed events have `replayed: "true"` in their meta.

## Persistent Store Pattern (Redis/DB)

For events that survive server restarts, load from an external store in `onConnect()`:

```typescript
@Channel({
  name: 'alerts',
  description: 'Persistent alerts with Redis-backed replay',
  source: { type: 'service', service: 'alert-store' },
  replay: { enabled: true, maxEvents: 500 },
})
class PersistentAlertChannel extends ChannelContext {
  async onConnect(): Promise<void> {
    // Load missed events from Redis on startup
    const redis = this.get(RedisClientToken);
    const stored = await redis.lrange('channel:alerts:buffer', 0, -1);

    for (const raw of stored) {
      const event = JSON.parse(raw);
      this.pushIncoming(event);
    }

    // Subscribe to new events via Redis pub/sub
    const subscriber = redis.duplicate();
    await subscriber.subscribe('channel:alerts', (message) => {
      const event = JSON.parse(message);
      // Store for future replays
      redis.rpush('channel:alerts:buffer', message);
      redis.ltrim('channel:alerts:buffer', -500, -1);
      // Push to connected Claude sessions
      this.pushIncoming(event);
    });

    this.logger.info('Alert store connected, loaded history');
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

## How Replay Works

1. Events arrive via any source → `onEvent()` transforms them → notification pushed
2. If `replay.enabled`, the notification is also stored in a ring buffer (FIFO, capped at `maxEvents`)
3. When a new Claude Code session connects, the server can call `channel.replayBufferedEvents(sessionId)`
4. All buffered events are sent to the new session with `replayed: "true"` in meta
5. Claude can distinguish live events from replayed ones via the meta field

## What This Demonstrates

- Replay configuration with maxEvents cap
- In-memory ring buffer for event storage
- Replay on session connect
- Persistent store pattern with onConnect

## Related

- See `channel-sources` for all source type documentation
