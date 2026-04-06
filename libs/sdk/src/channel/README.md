# FrontMCP Channels

Push-based notification channels for Claude Code and other MCP clients that support the `notifications/claude/channel` experimental extension.

## Architecture

```mermaid
graph TB
    subgraph "External Sources"
        WH[Webhook HTTP POST]
        AE[App Events]
        AC[Agent Completion]
        JC[Job/Workflow Completion]
        MN[Manual Push]
    end

    subgraph "Channel Module"
        CS[Channel Sources]
        CI[ChannelInstance]
        CR[ChannelRegistry]
        CNS[ChannelNotificationService]
        CEB[ChannelEventBus]
    end

    subgraph "Transport Layer"
        NS[NotificationService]
        SS1[Session 1 - Claude Code]
        SS2[Session 2 - Cursor]
        SS3[Session 3 - Other Client]
    end

    WH --> CS
    AE --> CEB --> CS
    AC --> CS
    JC --> CS
    MN --> CNS

    CS --> CI
    CI --> CNS
    CR -->|manages| CI
    CNS -->|sendCustomNotification| NS
    NS -->|filter: supportsChannels| SS1
    NS -.->|skipped: no capability| SS2
    NS -.->|skipped: no capability| SS3

    style SS1 fill:#2d8659,color:#fff
    style SS2 fill:#666,color:#fff
    style SS3 fill:#666,color:#fff
```

## Notification Flow

```mermaid
sequenceDiagram
    participant Src as External Source
    participant CH as ChannelInstance
    participant CTX as ChannelContext
    participant CNS as ChannelNotificationService
    participant NS as NotificationService
    participant CC as Claude Code Session

    Src->>CH: Event payload
    CH->>CTX: onEvent(payload)
    CTX-->>CH: { content, meta }
    CH->>CNS: sendToAllCapableSessions(content, meta)
    CNS->>NS: sendCustomNotification("notifications/claude/channel", ...)
    NS->>NS: Filter sessions with claude/channel capability
    NS->>CC: JSON-RPC notification

    Note over CC: Claude sees:<br/><channel source="deploy" env="prod">Deploy v1.2.3 succeeded</channel>
```

## Two-Way Communication

```mermaid
sequenceDiagram
    participant Ext as External System
    participant CH as ChannelInstance
    participant CC as Claude Code
    participant RT as ChannelReplyTool

    Ext->>CH: Incoming message
    CH->>CC: notifications/claude/channel
    Note over CC: Claude reads event,<br/>decides to reply
    CC->>RT: tool call: channel-reply
    RT->>CH: handleReply(text, meta)
    CH->>Ext: Forward reply (Slack, email, etc.)
```

## Capability Handshake

```mermaid
sequenceDiagram
    participant Client as MCP Client
    participant Server as FrontMCP Server

    Client->>Server: initialize { capabilities: { experimental: { "claude/channel": {} } } }
    Server-->>Client: initialize result { capabilities: { experimental: { "claude/channel": {} } }, instructions: "Events arrive as <channel> tags..." }
    Note over Server: NotificationService stores client capabilities per session
    Note over Server: ChannelNotificationService filters sends by capability
```

## Service Connector Pattern

```mermaid
sequenceDiagram
    participant CC as Claude Code
    participant ST as SendMessageTool
    participant SVC as External Service<br/>(WhatsApp, Telegram)
    participant CH as ChannelInstance
    participant CTX as ChannelContext

    Note over CTX,SVC: onConnect() establishes persistent connection

    CC->>ST: tool call: send-message({ to: "Alice", text: "Hi!" })
    ST->>SVC: API call (send message)
    ST-->>CC: { sent: true }

    SVC->>CTX: Incoming reply from Alice
    CTX->>CTX: pushIncoming(payload)
    CTX->>CH: handleEvent(payload)
    CH->>CC: notifications/claude/channel<br/>"Alice: Got it, will review now"

    Note over CC: Claude sees the reply as a <channel> tag<br/>and can continue the conversation
```

Service connectors maintain persistent connections to external messaging services.
Claude sends messages via channel-contributed tools and receives responses as channel notifications.

```typescript
@Channel({
  name: 'whatsapp',
  source: { type: 'service', service: 'whatsapp-business' },
  tools: [SendWhatsAppTool], // Claude calls this to send messages
  twoWay: true,
})
class WhatsAppChannel extends ChannelContext {
  private client: WhatsAppClient;

  async onConnect(): Promise<void> {
    this.client = new WhatsAppClient(process.env['WA_TOKEN']);
    this.client.on('message', (msg) => this.pushIncoming(msg));
    await this.client.connect();
  }

  async onDisconnect(): Promise<void> {
    await this.client.disconnect();
  }

  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const msg = payload as { from: string; text: string; chatId: string };
    return { content: `${msg.from}: ${msg.text}`, meta: { chat_id: msg.chatId } };
  }
}
```

## Module Structure

```
channel/
├── index.ts                           # Barrel exports
├── channel.events.ts                  # ChannelEmitter + ChannelChangeEvent
├── channel.instance.ts                # Concrete ChannelEntry implementation
├── channel.registry.ts                # Registry (extends RegistryAbstract)
├── channel.types.ts                   # IndexedChannel row type
├── channel.utils.ts                   # normalizeChannel() helpers
├── channel-notification.service.ts    # Sends notifications/claude/channel
├── channel-scope.helper.ts            # Orchestrates registration in Scope
├── flows/
│   ├── send-channel-notification.flow.ts  # Programmatic send flow
│   └── list-channels.flow.ts              # Health/status listing flow
├── reply/
│   ├── channel-reply.tool.ts          # Auto-registered reply tool
│   └── reply.types.ts                 # Reply input schema
└── sources/
    ├── index.ts                       # Source barrel
    ├── agent-completion.source.ts     # Subscribes to AgentEmitter
    ├── job-completion.source.ts       # Subscribes to JobEmitter
    ├── webhook.source.ts              # HTTP POST middleware
    └── app-event.source.ts            # In-process ChannelEventBus
```

## How It Works

### 1. Declaration

Channels are declared using `@Channel()` decorator or `channel()` function builder:

```typescript
@Channel({
  name: 'deploy-alerts',
  description: 'CI/CD deployment notifications',
  source: { type: 'webhook', path: '/hooks/deploy' },
  twoWay: true,
  meta: { team: 'platform' },
})
class DeployChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const data = payload as { body: { status: string; version: string } };
    return {
      content: `Deploy ${data.body.status}: ${data.body.version}`,
      meta: { env: 'production' },
    };
  }

  async onReply(reply: string): Promise<void> {
    await sendToSlack(reply);
  }
}
```

### 2. Registration

Channels are registered via app metadata:

```typescript
@App({
  name: 'DevOps',
  channels: [DeployChannel, ErrorChannel],
})
class DevOpsApp {}
```

And enabled at the server level:

```typescript
@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [DevOpsApp],
  channels: { enabled: true },
})
class Server {}
```

### 3. Scope Initialization

During `Scope.initialize()` (Batch 3, after NotificationService is ready):

1. `registerChannelCapabilities()` creates the `ChannelRegistry`
2. Each `ChannelInstance` gets a reference to `ChannelNotificationService`
3. Sources are wired: agent emitters, job emitters, event bus subscriptions
4. If any channel is `twoWay`, the `ChannelReplyTool` is auto-registered in `ToolRegistry`
5. Channel flows are registered in `FlowRegistry`

### 4. Capability Advertisement

The `ChannelRegistry.getCapabilities()` returns:

```json
{ "experimental": { "claude/channel": {} } }
```

This is merged into the MCP server's capabilities during transport setup (local adapter, stdio, unix socket).

### 5. Session-Scoped Notification Delivery

Channel notifications are **session-scoped** — each session only receives notifications
from channels it is subscribed to. This prevents data leaking between connected agents.

```mermaid
sequenceDiagram
    participant Init as Initialize Handler
    participant NS as NotificationService
    participant CNS as ChannelNotificationService

    Note over Init: Session connects with claude/channel capability
    Init->>NS: subscribeAllChannels(sessionId, ['deploy-alerts', 'errors'])

    Note over CNS: Event arrives for "deploy-alerts"
    CNS->>NS: getSubscribersForChannel('deploy-alerts')
    NS-->>CNS: [sessionId-A, sessionId-C]
    Note over CNS: Only subscribed sessions receive it
```

When an event arrives:

1. Source triggers `ChannelInstance.handleEvent(payload)`
2. Instance creates a `ChannelContext` and calls `onEvent(payload)`
3. The returned `ChannelNotification` is merged with static metadata
4. `ChannelNotificationService.sendToSubscribedSessions()` is called
5. `NotificationService.getSubscribersForChannel(channelName)` returns only subscribed sessions
6. Each subscribed session is also checked for `supportsChannels()` capability
7. Only subscribed + capable sessions receive the JSON-RPC notification

**Auto-subscription:** When a session initializes with `experimental: { 'claude/channel': {} }`
capability, it is automatically subscribed to all available channels. This happens in the
`initialize-request.handler.ts` (HTTP) and `runStdio()` (stdio).

**Manual subscription:** For fine-grained control, use `scope.notifications.subscribeChannel(sessionId, channelName)`.

**Unsubscription:** Channel subscriptions are cleaned up automatically when a session disconnects
(`unregisterServer()` removes all resource and channel subscriptions).

## Source Types

| Source             | Trigger                                   | Config                                                    |
| ------------------ | ----------------------------------------- | --------------------------------------------------------- |
| `webhook`          | HTTP POST to configured path              | `{ type: 'webhook', path: '/hooks/deploy' }`              |
| `app-event`        | In-process event bus emit                 | `{ type: 'app-event', event: 'error' }`                   |
| `agent-completion` | Agent finishes execution                  | `{ type: 'agent-completion', agentIds?: ['reviewer'] }`   |
| `job-completion`   | Job/workflow completes                    | `{ type: 'job-completion', jobNames?: ['daily-report'] }` |
| `service`          | Persistent connection to external service | `{ type: 'service', service: 'whatsapp-business' }`       |
| `manual`           | Programmatic push                         | `{ type: 'manual' }`                                      |

## Wire Protocol

Channel notifications use the `notifications/claude/channel` JSON-RPC method:

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/claude/channel",
  "params": {
    "content": "Deploy succeeded: v1.2.3",
    "meta": {
      "source": "deploy-alerts",
      "team": "platform",
      "env": "production"
    }
  }
}
```

In Claude Code, this renders as:

```xml
<channel source="deploy-alerts" team="platform" env="production">
Deploy succeeded: v1.2.3
</channel>
```

## Key Classes

| Class                        | Purpose                                                             |
| ---------------------------- | ------------------------------------------------------------------- |
| `ChannelContext`             | Abstract base for channel handlers (extends `ExecutionContextBase`) |
| `ChannelEntry`               | Abstract entry in registry (extends `BaseEntry`)                    |
| `ChannelInstance`            | Concrete entry with event handling and notification push            |
| `ChannelRegistry`            | Manages channel entries, provides capabilities                      |
| `ChannelNotificationService` | Sends `notifications/claude/channel` to capable sessions            |
| `ChannelEmitter`             | Pub/sub for registry change events                                  |
| `ChannelEventBus`            | In-process event bus for `app-event` sources                        |
| `ChannelReplyTool`           | Auto-registered tool for two-way channels                           |
