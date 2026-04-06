---
name: channel-sources
description: Configure different channel source types - webhooks, app events, agent completion, job completion, and manual push
---

# Channel Sources

Every channel has a source that determines how events flow into it. FrontMCP supports five source types, each optimized for a different integration pattern.

## Webhook Source

Registers an HTTP POST endpoint. External services (GitHub, CI/CD, monitoring) send payloads to this endpoint.

```typescript
@Channel({
  name: 'ci-alerts',
  description: 'CI/CD pipeline notifications',
  source: { type: 'webhook', path: '/hooks/ci' },
})
class CIAlertChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const { body } = payload as WebhookPayload;
    const data = body as { pipeline: string; status: string; url: string };
    return {
      content: `CI pipeline "${data.pipeline}" ${data.status}.\nDetails: ${data.url}`,
      meta: { pipeline: data.pipeline, status: data.status },
    };
  }
}
```

## App Event Source

Subscribes to the in-process `ChannelEventBus`. Your application code emits events, and the channel transforms them into notifications.

```typescript
@Channel({
  name: 'error-alerts',
  description: 'Application error notifications',
  source: { type: 'app-event', event: 'app:error' },
})
class ErrorAlertChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const error = payload as { message: string; stack?: string; level: string };
    return {
      content: `Application Error: ${error.message}\n${error.stack ?? ''}`,
      meta: { severity: error.level },
    };
  }
}

// In your application code:
scope.channelEventBus.emit('app:error', {
  message: 'Connection refused',
  stack: 'Error: ECONNREFUSED...',
  level: 'critical',
});
```

## Agent Completion Source

Automatically pushes when registered agents finish execution. Optionally filter by agent IDs.

```typescript
@Channel({
  name: 'agent-done',
  description: 'Notifies when AI agents complete their tasks',
  source: {
    type: 'agent-completion',
    agentIds: ['code-reviewer', 'test-writer'],
  },
})
class AgentDoneChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const event = payload as {
      agentId: string;
      status: string;
      durationMs: number;
      output?: string;
    };
    return {
      content: `Agent "${event.agentId}" finished (${event.status}) in ${event.durationMs}ms.${
        event.output ? `\nResult: ${event.output}` : ''
      }`,
      meta: { agentId: event.agentId, status: event.status },
    };
  }
}
```

## Job Completion Source

Pushes when background jobs or workflows complete. Optionally filter by job names.

```typescript
@Channel({
  name: 'job-done',
  description: 'Background job completion notifications',
  source: {
    type: 'job-completion',
    jobNames: ['daily-report', 'data-sync'],
  },
})
class JobDoneChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const event = payload as {
      jobName: string;
      status: string;
      durationMs: number;
    };
    return {
      content: `Job "${event.jobName}" ${event.status} (${event.durationMs}ms)`,
      meta: { jobName: event.jobName, status: event.status },
    };
  }
}
```

## Service Connector Source

Maintains a persistent connection to an external service. Claude sends outbound messages via channel-contributed tools, and incoming messages trigger `onEvent()`.

```typescript
@Channel({
  name: 'whatsapp',
  source: { type: 'service', service: 'whatsapp-business' },
  tools: [SendWhatsAppTool], // Auto-registered for Claude to call
  twoWay: true,
})
class WhatsAppChannel extends ChannelContext {
  async onConnect(): Promise<void> {
    // Establish connection, start listening for incoming messages
    this.client.on('message', (msg) => this.pushIncoming(msg));
  }
  async onDisconnect(): Promise<void> {
    /* tear down */
  }
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    /* transform */
  }
}
```

## File Watcher Source

Watches file system paths for changes and pushes notifications. Uses `onConnect()` to start the watcher.

```typescript
@Channel({
  name: 'log-watcher',
  source: {
    type: 'file-watcher',
    paths: ['./logs/app.log', './logs/error.log'],
    events: ['change', 'create'],
  },
})
class LogWatcherChannel extends ChannelContext {
  async onConnect(): Promise<void> {
    // Start watching files, call pushIncoming() on changes
  }
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const event = payload as { file: string; content: string };
    return { content: `[${event.file}] ${event.content}`, meta: { file: event.file } };
  }
}
```

## Manual Source

No automatic wiring. Push notifications programmatically via `scope.channelNotifications.send()`.

```typescript
const StatusChannel = channel({
  name: 'status-updates',
  description: 'Manual status broadcast',
  source: { type: 'manual' },
})((payload) => ({
  content: `Status: ${(payload as { message: string }).message}`,
}));

// Push from anywhere with scope access:
scope.channelNotifications.send('status-updates', 'Server maintenance starting in 5 minutes');
```

## Replay Buffer

Enable event buffering so events are preserved when Claude Code is not connected:

```typescript
@Channel({
  name: 'ci-alerts',
  source: { type: 'webhook', path: '/hooks/ci' },
  replay: { enabled: true, maxEvents: 100 },
})
class CIAlertChannel extends ChannelContext {
  /* ... */
}
```

Buffered events are replayed when a new session connects, with `replayed: "true"` in meta.

## Examples

| Example                                                                 | Level        | Description                                                                                                                      |
| ----------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| [`webhook-github`](../examples/channel-sources/webhook-github.md)       | Basic        | Forward GitHub webhook events (PRs, pushes, CI) into Claude Code                                                                 |
| [`app-errors`](../examples/channel-sources/app-errors.md)               | Basic        | Forward application errors to Claude Code via the in-process event bus                                                           |
| [`agent-notify`](../examples/channel-sources/agent-notify.md)           | Intermediate | Notify Claude Code when AI agents complete their tasks                                                                           |
| [`job-completion`](../examples/channel-sources/job-completion.md)       | Intermediate | Notify Claude Code when background jobs and workflows complete                                                                   |
| [`service-connector`](../examples/channel-sources/service-connector.md) | Advanced     | Build a persistent service connector that lets Claude send and receive messages through WhatsApp, Telegram, or any messaging API |
| [`file-watcher`](../examples/channel-sources/file-watcher.md)           | Intermediate | Watch files for changes and notify Claude Code in real-time                                                                      |
| [`replay-buffer`](../examples/channel-sources/replay-buffer.md)         | Advanced     | Buffer channel events so Claude Code receives them when it connects, even if events occurred while offline                       |

> See all examples in [`examples/channel-sources/`](../examples/channel-sources/)
