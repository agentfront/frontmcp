---
name: channel-sources
description: Configure different channel source types - webhooks, app events, agent/job completion, service connectors, file watchers, and manual push
---

# Channel Sources

Every channel has a source that determines how events flow into it. FrontMCP supports seven source types, each optimized for a different integration pattern.

Whatever the source, `onEvent()` may return any `meta` keys. A character of a key that is not a letter, a digit or an underscore is sent as `_` (`chat-id` as `chat_id`), because Claude Code drops such a key (see `channel-claude-code`).

## Webhook Source

Registers an HTTP POST endpoint. External services (GitHub, CI/CD, monitoring) send payloads to this endpoint.

```typescript
// Webhook payloads have a known shape: { body, headers, method, query? }.
// Define the slice you need locally rather than importing an internal type.
interface CIWebhookBody {
  pipeline: string;
  status: string;
  url: string;
}

@Channel({
  name: 'ci-alerts',
  description: 'CI/CD pipeline notifications',
  source: { type: 'webhook', path: '/hooks/ci' },
})
class CIAlertChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const { body } = payload as { body: unknown };
    const data = body as CIWebhookBody;
    return {
      content: `CI pipeline "${data.pipeline}" ${data.status}.\nDetails: ${data.url}`,
      meta: { pipeline: data.pipeline, status: data.status },
    };
  }
}
```

The path is a `POST` route on FrontMCP's HTTP server (`bootstrap()` / `createHandler()`), guarded like a custom `http.routes` entry: `throttle.ipFilter` runs first, the path may not be a FrontMCP path (MCP endpoint, `/oauth/*`, `/.well-known/*`, `/health`, `/metrics`), and one channel per path (either mistake fails startup). The route does not authenticate the sender: verify signatures (e.g. `X-Hub-Signature-256`) in `onEvent()`. `createFetchHandler()` serves the route too. `createDirect()` and stdio serve no webhook route; `create()`, `createDirect()` and `connect()` log a warning for a webhook source.

## App Event Source

Subscribes to the in-process `ChannelEventBus`. Your application code emits events, and the channel transforms them into notifications. The bus is the scope's event bus, which `trigger: 'event'` workflows listen on too (see `create-workflow`): one `emit()` reaches both.

Use it for a name your code emits on the bus by hand. For an event the server publishes (`@Event`), use the event's `channel` option (see [Published events as a source](#published-events-as-a-source)).

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

// In your application code (in a tool: this.scope.channelEventBus):
scope.channelEventBus?.emit('app:error', {
  message: 'Connection refused',
  stack: 'Error: ECONNREFUSED...',
  level: 'critical',
});
```

### Published events as a source

To tell Claude Code about an event the server publishes with `this.events.publish()`, set the `channel` option of the `@Event` (see [`create-event`](../../frontmcp-development/references/create-event.md#telling-a-claude-code-session)). It needs no channel class, and each session is told only what its caller may see. Keep the `app-event` source for events your code emits on the bus by hand, as above.

An `app-event` channel named after an event still works. A server that declares events emits each one it publishes on the same bus, under the event's name. The payload is the occurrence, `{ eventId, name, timestamp, data }`:

```typescript
@Channel({
  name: 'new-orders',
  description: 'Orders as they are placed',
  source: { type: 'app-event', event: 'order.created' },
})
class NewOrdersChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const { data } = payload as { eventId: string; data: { orderId: string; total: number } };
    return { content: `Order ${data.orderId} was placed (${data.total})`, meta: { orderId: data.orderId } };
  }
}
```

The channel gets every published occurrence of that name, once, whoever is subscribed to the event, except one published with an `audience` or a `subscriptionId`: it is meant for some owners only, and a channel tells every connected session, so it reaches only trusted listeners such as `trigger: 'event'` workflows. `events.bridge: false` keeps published events off the bus. An event that also has the `channel` option is told to a session twice.

The server logs one line at startup for each `app-event` channel whose `event` is a declared event:

- The event has the `channel` option: a warning. `Channel "new-orders" listens to event "order.created", which has the channel option: Claude Code sessions get each occurrence twice, once from the event and once from the channel. Keep one: remove the channel, or the option when the channel does what the option cannot.`
- The event has no `channel` option: an info line. `Channel "new-orders" listens to event "order.created": the event has no channel option. Setting it can replace this channel, and checks each session's access.`

It logs neither for a name that is not a declared event, or with `events.bridge: false`. Nothing else changes: the channel is still told.

## Agent Completion Source

Automatically pushes when registered agents finish execution. Optionally filter by agent IDs.

An event is published once an `invoke_<agent>` call has finished: `status: 'success'` only when the agent's output also passed its `outputSchema` (output that fails it is an `'error'`), and a call waiting for the client's answer to an elicitation publishes nothing until it finishes.

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

The event is `{ agentId, agentName, status: 'success' | 'error', durationMs, output?, error?, runId?, sessionId }`, published after every `invoke_<agent>` call and delivered only to the session that called the agent.

## Job Completion Source

Pushes when background jobs or workflows complete. Optionally filter by job names. The event is `{ jobName, jobId, status: 'success' | 'error' | 'timeout' | 'cancelled', durationMs?, output?, error?, attempt, sessionId }` (for a workflow, `jobName` is its name): a job run that ended `timed_out` is a `'timeout'`, a `cancelled` one a `'cancelled'`, and one `interrupted` at shutdown an `'error'`. It goes only to the session that ran the job; a run with no session is delivered to no one.

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

Watches files and directories. For a channel that defines no `onConnect()`, the framework watches the declared `paths` while the channel is connected, and hands each file event to `onEvent()`. The channel needs no watcher of its own.

A channel that defines its own `onConnect()` watches by itself, as before 1.12, when the `paths` and `events` were only a label. Such a channel keeps working unchanged (see [A channel with its own `onConnect()`](#a-channel-with-its-own-onconnect)).

```typescript
import { basename } from 'node:path';

import { Channel, ChannelContext, type ChannelFileEvent, type ChannelNotification } from '@frontmcp/sdk';

@Channel({
  name: 'log-watcher',
  source: {
    type: 'file-watcher',
    paths: ['./logs/app.log', './reports'],
    events: ['create', 'change'],
  },
})
class LogWatcherChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const { event, path } = payload as ChannelFileEvent;
    const fileName = basename(path);
    return { content: `${fileName}: ${event}`, meta: { file: fileName, event } };
  }
}
```

| Field     | Type                                               | Default    | Notes                                                               |
| --------- | -------------------------------------------------- | ---------- | ------------------------------------------------------------------- |
| `paths`   | `string[]`                                         | Required   | Files or directories, absolute or relative to the working directory |
| `events?` | `('create' \| 'change' \| 'delete' \| 'rename')[]` | Every kind | The kinds of file event the channel gets                            |

- **Payload.** `onEvent()` gets a `ChannelFileEvent`, `{ event, path }`. `event` is `'create'` (the file appeared), `'change'` (its size, its modification time or the file itself was replaced) or `'delete'` (it is gone). `path` is the absolute path of the file.
- **Order.** The events of a channel are handed to `onEvent()` one at a time, in the order they happened: the next starts once the one before it ended, so a slow `onEvent()` delays the events after it.
- **`rename`.** There is no `rename` payload. A renamed file is a `delete` of its old path and a `create` of its new one, so `rename` selects both.
- **Paths.** A directory is watched for its direct files, not for its subdirectories. A file is watched through its parent directory, so it stays watched when an editor replaces it. A path that does not exist yet is watched from the moment it appears. The files that are there when the watch starts are not reported.
- **No globs.** A path is watched as written. For `./logs/*.log` the server logs a warning at startup and watches a file of that name: declare `./logs`, or each file.
- **Debounce.** A change is reported once its directory saw no change for 100 ms. Several writes to one file in that time are one `change`.
- **Lifetime.** The watch starts when the channel is connected, at startup. It ends when the channel disconnects, at shutdown and at `dispose()`, before `onDisconnect()` runs.
- **Where it does not run.** In a serverless, edge or browser runtime nothing is watched: the server logs a warning and still connects the channel. CLI mode and a build that boots the server to read it register no channel, so they watch nothing.
- **Failure.** A watch that fails is logged (`Channel "log-watcher" stopped watching its paths`). The server and its other channels keep running.

The watch is `watchFiles()` from `@frontmcp/utils` (see `create-worker`). To publish file changes as an event that poll, push and webhook clients also get, loop over `watchFiles()` in a `@Worker` and set the event's `channel` option.

### A channel with its own `onConnect()`

The framework watches the declared paths only for a channel that defines no `onConnect()`. When the channel's class, or a class it extends, defines `onConnect()`, the channel is taken to watch by itself:

- `onConnect()` and `onDisconnect()` run, as for a `service` source.
- The framework watches nothing for it. `onEvent()` gets only what the channel pushes with `pushIncoming()`, in the shape the channel chose.
- `paths` and `events` are a label the channel may read from `this.metadata.source`. The warnings above (a glob, a runtime that cannot watch) are not logged for it.
- The server logs one info line at startup: `Channel "log-watcher" defines onConnect(), so it watches by itself: the framework does not watch its declared paths. Remove onConnect() to have the framework watch them.`

So a channel written before 1.12 keeps working unchanged. To move it to the framework's watch, remove its `onConnect()`, its `onDisconnect()` and its watcher, and read `{ event, path }` in `onEvent()`.

A `channel()` function has no connect handler, so the framework always watches its declared paths.

A channel that watches by itself:

```typescript
import { watch, type FSWatcher } from 'node:fs';

import { Channel, ChannelContext, type ChannelFileWatcherSource, type ChannelNotification } from '@frontmcp/sdk';

@Channel({
  name: 'legacy-log-watcher',
  source: { type: 'file-watcher', paths: ['./logs/app.log'] },
})
class LegacyLogWatcherChannel extends ChannelContext {
  private watcher?: FSWatcher;

  async onConnect(): Promise<void> {
    const [logFile] = (this.metadata.source as ChannelFileWatcherSource).paths;
    this.watcher = watch(logFile, () => this.pushIncoming({ file: logFile }));
  }

  async onDisconnect(): Promise<void> {
    this.watcher?.close();
  }

  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const { file } = payload as { file: string };
    return { content: `${file} changed`, meta: { file } };
  }
}
```

## Manual Source

No automatic wiring. Push notifications programmatically via `scope.channelNotifications.send()`, which runs the hookable `channels:send-notification` flow like every channel notification: `channels.defaultMeta`, then the channel's `meta`, then the notification's own meta, with `source` set to the channel name.

```typescript
const StatusChannel = channel({
  name: 'status-updates',
  description: 'Manual status broadcast',
  source: { type: 'manual' },
})((payload) => ({
  content: `Status: ${(payload as { message: string }).message}`,
}));

// Push from anywhere with scope access:
await scope.channelNotifications?.send('status-updates', 'Server maintenance starting in 5 minutes');
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
| [`replay-buffer`](../examples/channel-sources/replay-buffer.md)         | Advanced     | Buffer channel events so Claude Code receives them when it connects, even if events occurred while offline.                      |

> See all examples in [`examples/channel-sources/`](../examples/channel-sources/)
