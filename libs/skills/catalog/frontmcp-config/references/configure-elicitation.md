---
name: configure-elicitation
description: Configure interactive user input during tool execution for confirmations, choices, and forms
---

# Configuring Elicitation

Elicitation allows tools to request interactive input from users mid-execution — confirmations, choices, or structured form data.

## When to Use This Skill

### Must Use

- Tools need user confirmation before destructive actions (delete, deploy, overwrite)
- Building interactive multi-step workflows that require user decisions mid-execution
- Tools need structured form input from the user during execution (e.g., parameter selection, file choice)

### Recommended

- Adding a safety gate to tools that modify external systems (databases, APIs, deployments)
- Implementing approval flows where a tool must get explicit consent before proceeding
- Multi-instance production deployments where elicitation state must be shared via Redis

### Skip When

- Tools are fully autonomous and never need user input -- elicitation adds overhead when unused
- The MCP client does not support elicitation -- check client capabilities first (see Notes section)
- Only need input validation, not mid-execution prompts -- use Zod input schemas on the `@Tool` decorator

> **Decision:** Use this skill when tools need to pause execution and request interactive input from the user; skip if all tools run autonomously without user interaction.

## Enable Elicitation

### Basic (In-Memory)

```typescript
@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  elicitation: {
    enabled: true,
  },
})
class Server {}
```

### With Redis (Distributed/Production)

```typescript
@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  elicitation: {
    enabled: true,
    redis: { provider: 'redis', host: 'localhost', port: 6379 },
  },
})
class Server {}
```

## ElicitationOptionsInput

```typescript
interface ElicitationOptionsInput {
  enabled?: boolean; // default: false
  redis?: RedisOptionsInput; // storage for elicitation state
  persistent?: boolean | { ttlMs?: number; storage?: StorageConfig }; // questions that outlive the session
}
```

## Using Elicitation in Tools

When elicitation is enabled, tools can request user input via the MCP elicitation protocol:

```typescript
import { Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'delete_records',
  description: 'Delete records from the database',
  inputSchema: {
    table: z.string(),
    filter: z.string(),
  },
  outputSchema: { deleted: z.number() },
})
class DeleteRecordsTool extends ToolContext {
  async execute(input: { table: string; filter: string }) {
    // Count records that would be deleted
    const db = this.get(DB_TOKEN);
    const count = await db.count(input.table, input.filter);

    // Request confirmation from user before proceeding
    const confirmation = await this.elicit({
      message: `This will delete ${count} records from ${input.table}. Are you sure?`,
      requestedSchema: {
        type: 'object',
        properties: {
          confirmed: { type: 'boolean', description: 'Confirm deletion' },
        },
        required: ['confirmed'],
      },
    });

    if (!confirmation || !confirmation.confirmed) {
      return { deleted: 0 };
    }

    const deleted = await db.delete(input.table, input.filter);
    return { deleted };
  }
}
```

## How It Works

1. Tool calls `this.elicit()` with a message and requested schema
2. Server sends an `elicitation/request` to the client
3. Client displays the request to the user (UI varies by client)
4. User responds with structured data matching the schema
5. `this.elicit()` returns the user's response
6. Tool continues execution with the response

## Persistent Questions (Outlive the Session)

A question can wait longer than the call that asked it: a person answers it later in the **inbox** (a web page, or
`frontmcp inbox`), and the answer reaches the waiting call, or the next call of the same caller that asks it.

```typescript
@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  http: { port: 3000, auth: { people: 'loopback-token' } }, // the inbox is a people route
  elicitation: { enabled: true, persistent: true }, // or { ttlMs: 86_400_000, storage: { type: 'sqlite', sqlite: { path } } }
})
class Server {}
```

```typescript
import { printQuestionInboxLink, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({ name: 'approve_deploy', inputSchema: { version: z.string() } })
class ApproveDeployTool extends ToolContext {
  async execute(input: { version: string }) {
    const answer = await this.elicit(`Deploy ${input.version}?`, z.object({ approve: z.boolean() }), {
      ttl: 60_000, // how long THIS call waits
      persist: { key: `deploy-${input.version}` }, // keep the question (default: elicitation.persistent.ttlMs, 24 h)
    });
    return { approved: answer.status === 'accept' && answer.content?.approve === true };
  }
}

// Print a one-time sign-in link to the caller's inbox on the server console, for the person at the machine
@Tool({ name: 'inbox_link', inputSchema: {} })
class InboxLinkTool extends ToolContext {
  async execute() {
    return printQuestionInboxLink(this); // { expiresAt }: the link itself goes to stderr, never to the MCP client
  }
}
```

- **Who a question belongs to (its subject):** `principal:<sub>` for a signed-in caller (a reconnect, or any session of
  that user, gets the answer), else `session:<id>` for the verified session. An anonymous caller with neither is refused
  (`ElicitationNotSupportedError`).
- **Who may answer:** only a person signed in **for that subject**. `printQuestionInboxLink(this)` prints, on the
  server's console (stderr, like the startup token), a one-time link whose code is bound to the caller's subject; the
  session it buys sees and answers that subject's questions only. The caller gets only `{ expiresAt }`: a code in a tool
  result would let the agent sign in and approve its own question. Another subject, and a person signed in with the
  startup token, get an empty inbox and `404` for any question id. An app that reaches its people another way (email, a
  chat) can make the code itself with `LoopbackTokenAuth.createCode({ subject })` and must send it to the person only.
- **The inbox (people routes):** `GET /_frontmcp/inbox` (a page), `GET /_frontmcp/questions` (JSON),
  `GET /_frontmcp/questions/events` (SSE of the same view, updated on every change),
  `POST /_frontmcp/questions/:id/answer` with `{ "action": "accept" | "decline" | "cancel", "content"?: {...} }`. They run
  through the `http:route` flow, so the answer route gets the same-origin check (`403` from another site). An accept is
  validated against the question's schema (`400`); a second answer gets `409`.
- **The CLI:** `frontmcp inbox <sign-in link>` (or the printed path with `--url <server>`) spends the link's one-time
  code like a browser, lists the questions (and asks on a terminal); `--answer <id> --content '{"approve":true}'` (or
  `--decline` / `--cancel`) answers one. Each run needs a fresh link.
- **Delivery, once:** the waiting call gets the answer; when it stopped waiting (its `ttl` passed, or the session ended),
  it fails with `QuestionPendingError` (`408`) and the answer waits for the next call that asks the same key. When a newer
  call of the subject asks while one waits, the newer one waits for it and the older fails with
  `QuestionSupersededError`. Each answer is handed to one call only.
- **Storage:** `persistent.storage` (memory, redis or sqlite), else the server's `redis`, else its `sqlite`, else
  `questions.sqlite` in `$FRONTMCP_HOME` (`~/.frontmcp`, made owner-only). Serverless and edge need one named. With
  `MCP_ELICITATION_SECRET` (or `MCP_SESSION_SECRET` / `MCP_SERVER_SECRET`) set, questions and answers are encrypted at
  rest with a key derived from the subject. An invalid `persistent` fails startup with `InvalidQuestionStoreError`.
- `persist.ttlMs` must be longer than the call's `ttl`; URL mode cannot be persisted (`INVALID_INPUT`).

## Notes

- When `enabled: false` (default), `this.elicit()` is not available — keeps resource overhead low
- When enabled, tool output schemas are automatically extended with elicitation fallback type
- Use Redis storage for production/multi-instance deployments
- The `elicitation:request` and `elicitation:result` flows (and their `ElicitationRequestHook` / `ElicitationResultHook` plugin hooks) run on every transport, including the in-process client of `connect()` / `createDirect()`; an unanswered question fails with `ElicitationTimeoutError` there too
- Not all MCP clients support elicitation — handle gracefully when `this.elicit()` returns `undefined`

## Verification

```bash
# Enable elicitation and start
frontmcp dev

# Test with an MCP client that supports elicitation
# The tool should pause and request user input
```

## Common Patterns

| Pattern                      | Correct                                                                 | Incorrect                                                        | Why                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Handling unsupported clients | Check `if (!confirmation)` after `this.elicit()` and provide a fallback | Assuming `this.elicit()` always returns a value                  | Not all MCP clients support elicitation; `undefined` is returned when the client cannot handle the request       |
| Schema for confirmation      | Use `{ confirmed: { type: 'boolean' } }` in `requestedSchema`           | Using a plain string prompt without a schema                     | Structured schemas let the client render proper UI controls (checkboxes, dropdowns) instead of free-text input   |
| Redis for production         | Set `elicitation: { enabled: true, redis: { provider: 'redis', ... } }` | Using in-memory elicitation state in a multi-instance deployment | In-memory state is per-process; if the response arrives at a different instance, the elicitation context is lost |
| Enabled flag                 | Explicitly set `elicitation: { enabled: true }`                         | Omitting the `enabled` field and expecting elicitation to work   | Elicitation is disabled by default (`enabled: false`) to minimize resource overhead                              |
| Answer after a disconnect    | `persist: { key }` with `elicitation.persistent`, answered in the inbox | A long `ttl` alone                                               | A plain question dies with its session; a persistent one waits in the store for the next call of the caller      |

## Verification Checklist

### Configuration

- [ ] `elicitation.enabled` is set to `true` in the `@FrontMcp` decorator
- [ ] For production/multi-instance: `elicitation.redis` is configured with a valid Redis provider
- [ ] The `requestedSchema` in `this.elicit()` calls uses valid JSON Schema objects

### Runtime

- [ ] Tool execution pauses when `this.elicit()` is called and the client supports elicitation
- [ ] The user sees a prompt or form matching the requested schema
- [ ] After the user responds, `this.elicit()` returns the structured data and the tool resumes
- [ ] When the client does not support elicitation, `this.elicit()` returns `undefined` and the tool handles the fallback gracefully

### Integration

- [ ] MCP client under test advertises elicitation support in its capabilities
- [ ] Destructive tools have elicitation-based confirmation gates before proceeding

## Troubleshooting

| Problem                                           | Cause                                                                       | Solution                                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `this.elicit is not a function`                   | Elicitation is not enabled in the server configuration                      | Set `elicitation: { enabled: true }` in the `@FrontMcp` decorator                                   |
| `this.elicit()` returns `undefined` immediately   | The connected MCP client does not support elicitation                       | Check client capabilities; provide a fallback code path for unsupported clients                     |
| Elicitation works locally but fails in production | In-memory store loses state across multiple server instances                | Configure `elicitation.redis` to share elicitation state via Redis                                  |
| User sees raw JSON instead of a form              | The MCP client renders the `requestedSchema` as raw data rather than a form | Use standard JSON Schema types (`boolean`, `string`, `enum`) that clients can render as UI controls |
| Tool hangs indefinitely waiting for user response | No timeout configured and user never responds                               | Implement a timeout or cancellation mechanism in the tool logic to handle non-responsive users      |
| `QuestionPendingError` from a persistent question | The call stopped waiting before anyone answered                             | Answer in the inbox, then call again with the same `persist.key`: that call gets the answer         |
| The inbox is empty for the person                 | They signed in with the startup token, or for another caller                | Open the link `printQuestionInboxLink(this)` printed for a call of the caller that asked            |

## Examples

| Example                                                                                               | Level        | Description                                                                         |
| ----------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------- |
| [`basic-confirmation-gate`](../examples/configure-elicitation/basic-confirmation-gate.md)             | Basic        | Request user confirmation before executing a destructive action.                    |
| [`distributed-elicitation-redis`](../examples/configure-elicitation/distributed-elicitation-redis.md) | Intermediate | Configure elicitation with Redis storage for multi-instance production deployments. |
| [`persistent-questions-inbox`](../examples/configure-elicitation/persistent-questions-inbox.md)       | Advanced     | Keep a question for its caller past the session, answered in the inbox or the CLI.  |

> See all examples in [`examples/configure-elicitation/`](../examples/configure-elicitation/)

## Reference

- [Elicitation Docs](https://frontmcp.dev/reference/sdk/elicit)
- Related skills: `configure-http`, `configure-transport`, `setup-redis`, `create-tool`
