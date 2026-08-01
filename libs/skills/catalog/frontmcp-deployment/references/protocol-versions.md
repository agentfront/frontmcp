---
name: protocol-versions
description: Serve MCP protocol revision 2026-07-28 alongside every earlier revision, and connect to a 2026 server as a client
---

# MCP Protocol Versions

FrontMCP serves **every MCP revision from `2024-11-05` through `2026-07-28`** on
the same endpoint. The revision is selected per request — there is no
configuration switch and no server-side flag to flip.

## When to Use This Skill

### Must Use

- A client reports `-32020`, `-32021`, or `-32022` against a FrontMCP server
- Building a tool that needs elicitation, sampling, or roots on a 2026 client
- Connecting FrontMCP to a remote MCP server that speaks `2026-07-28`
- Returning long-running work as a task handle under the tasks extension

### Recommended

- Auditing which revision a deployed server is actually serving to a client
- Adding `x-mcp-header` annotations so intermediaries can route on tool arguments
- Wiring OpenTelemetry trace context through MCP requests

### Skip When

- The client speaks `2025-11-25` or earlier — nothing changes for it
- You are configuring transports/ports (see `deploy-to-node`)

## How a revision is selected

A request is served as `2026-07-28` when ANY of these is true:

- `params._meta` carries `io.modelcontextprotocol/protocolVersion` (a key that
  exists only in this revision)
- the `MCP-Protocol-Version` header names a version the session pipeline does not
  know (an unknown/future version then gets `-32022`, not a session error)
- the method is `server/discover` or `subscriptions/listen`

Everything else — including every `initialize` and every request carrying
`Mcp-Session-Id` — takes the session pipeline unchanged.

## What 2026-07-28 changed

| Area          | Before                                     | 2026-07-28                                           |
| ------------- | ------------------------------------------ | ---------------------------------------------------- |
| Handshake     | `initialize` + `notifications/initialized` | none; `_meta` on every request                       |
| Sessions      | `Mcp-Session-Id`                           | removed (`GET`/`DELETE` → `405`)                     |
| Discovery     | `initialize` result                        | `server/discover`                                    |
| Notifications | standalone GET stream                      | `subscriptions/listen` (opt-in filter)               |
| Server→client | `elicitation/create` etc. as requests      | MRTR `InputRequiredResult`                           |
| Log level     | `logging/setLevel`                         | per-request `_meta` `logLevel`                       |
| Results       | bare result                                | `resultType` + `serverInfo` (+ `ttlMs`/`cacheScope`) |
| Tasks         | core protocol                              | `io.modelcontextprotocol/tasks` extension            |
| Not found     | `-32002`                                   | `-32602`                                             |

## Mirrored request headers

The server validates that headers agree with the body and rejects a mismatch
with `400` + `-32020`. Annotate a tool argument to have it mirrored:

```ts
const inputSchema = {
  region: z.string().describe('Region to query').meta({ 'x-mcp-header': 'Region' }),
  query: z.string(),
};
```

A conforming client then sends `Mcp-Param-Region: us-west1` alongside
`MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name`. Non-ASCII values travel as
`=?base64?…?=`.

## Multi Round-Trip Requests (MRTR)

`this.elicit()`, `this.sample()`, and `this.listRoots()` no longer round-trip
inline. The server answers the ORIGINAL request with:

```json
{
  "resultType": "input_required",
  "inputRequests": { "elicitation-1": { "method": "elicitation/create", "params": { "message": "Proceed?" } } },
  "requestState": "<opaque, signed>"
}
```

The client gathers the input and re-issues the same request with a NEW id plus
`inputResponses` + the echoed `requestState`.

**Write tools to be replay-safe.** The tool runs again from the top on the
retry; recorded answers resolve inline. Do not perform irreversible side effects
before the first `elicit()`/`sample()`/`listRoots()` call.

`requestState` is HMAC-signed and bound to the caller, the originating request,
and a 10-minute expiry — a tampered or replayed blob is discarded and the
exchange restarts.

The client MUST declare the matching capability, or the server answers `-32021`:

```json
"io.modelcontextprotocol/clientCapabilities": { "elicitation": { "form": {} } }
```

## Request-scoped logging and progress

A client opts in per request:

```json
"_meta": { "io.modelcontextprotocol/logLevel": "info", "progressToken": "tok-1" }
```

`this.notify()` and `this.progress()` then stream on that request's own SSE
response, terminated by the final result. Omit `logLevel` and the server emits
no `notifications/message` at all.

## Tasks extension

```json
"io.modelcontextprotocol/clientCapabilities": {
  "extensions": { "io.modelcontextprotocol/tasks": {} }
}
```

A tool with `execution: { taskSupport: 'optional' }` then returns
`{ "resultType": "task", "task": { "taskId", "status", "ttlMs", "pollIntervalMs" } }`.
Poll `tasks/get`; answer `input_required` with `tasks/update`; `tasks/cancel`
still works. `tasks/list` and `tasks/result` were removed.

Tasks require an **authenticated** caller — without protocol sessions an
anonymous task cannot be scoped to its creator, so a public server refuses.

## Connecting as a client

The upstream `@modelcontextprotocol/sdk` client cannot speak this revision:

```ts
import { Mcp2026Client } from '@frontmcp/sdk';

const client = new Mcp2026Client({
  url: 'https://example.com/mcp',
  capabilities: { elicitation: { form: {} } },
  handlers: { onElicit: async () => ({ action: 'accept', content: { confirmed: true } }) },
});

await client.listTools();
await client.callTool('confirm', { action: 'deploy' });
```

The MRTR retry loop and task polling are handled internally, so `callTool`
resolves with the final result either way.

For a remote app, negotiate per remote:

```ts
transportOptions: {
  protocolVersion: 'auto';
} // 'legacy' (default) | '2026-07-28' | 'auto'
```

## Deprecated in this revision

Still functional; do not adopt in new servers:

- **Roots** → pass directories via tool parameters or server config
- **Sampling** → integrate an LLM provider API directly
- **Logging** → `stderr` or OpenTelemetry
- **HTTP+SSE transport** → Streamable HTTP
- **DCR** → Client ID Metadata Documents

## Common Mistakes

❌ Reusing the JSON-RPC id on an MRTR retry — it MUST be a new id
❌ Inspecting or rewriting `requestState` — it is opaque and integrity-protected
❌ Performing side effects before the first `elicit()` — the tool is replayed
❌ Expecting `Mcp-Session-Id` to be echoed — sessions are gone
❌ Calling `tasks/list` or `tasks/result` — both removed (`404` + `-32601`)
❌ Omitting `Mcp-Method`/`Mcp-Name` headers — rejected with `-32020`

## Related

- Docs: https://docs.agentfront.dev/frontmcp/fundamentals/protocol-versions
- Spec: https://modelcontextprotocol.io/specification/2026-07-28/changelog
