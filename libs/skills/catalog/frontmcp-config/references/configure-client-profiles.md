---
name: configure-client-profiles
description: Shape answers per MCP client with clients profiles - text, structuredContent or both, resource annotations, and skills instructions
---

# Configure Client Profiles

MCP clients read tool answers differently. Some put the text content in front of the model, some read `structuredContent`, and a `tools/call` answer carries the same JSON in both, so it is sent twice. Some clients also choke on numeric resource annotations, or copy the server instructions into every tool. A `clients` profile, matched on the `clientInfo.name` a client sends at `initialize`, sets what that client receives.

## When to Use This Skill

### Must Use

- A client fails on numeric annotations (`priority`) in `resources/list`
- A client needs only the text (or only `structuredContent`) and the duplicate wastes its context

### Recommended

- You serve a known coding agent (Codex, Claude Code) and want to cut the bytes each answer costs; measure first with the answer-cost counters on `/metrics`

### Skip When

- All your clients read both copies fine; the default (`'both'`) is what the MCP spec recommends
- You want to cap how big an answer is: that is `output.budget` (see `create-tool` → `output-schema`)

> **Decision:** Use a profile when one client needs different answers. Leave the defaults for everyone else.

## Configuration

```typescript
@FrontMcp({
  info: { name: 'reports', version: '1.0.0' },
  apps: [ReportsApp],
  clients: {
    'codex-mcp-client': { structured: 'text' },
    'claude-code': { structured: 'only', instructions: 'compact' },
    'rust-mcp-*': { annotations: 'no-numbers' },
  },
})
class Server {}
```

Each key is a glob of `clientInfo.name` (`*` any characters, `?` one), matched without regard to case; the first key that matches wins. OpenAI Codex sends `codex-mcp-client` (some versions `Codex`), Claude Code sends `claude-code`. A profile sets any of three fields; an unset field keeps the server-wide behaviour.

| Field          | Values             | Effect                                                                                                                                                                                                                                           |
| -------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `structured`   | `'both'` (default) | The JSON in the text content and the same value in `structuredContent`.                                                                                                                                                                          |
|                | `'only'`           | `structuredContent`, with a one-line summary as the text: `The answer is in structuredContent: rows (30 items), total: 1000.` Only for tools whose `outputSchema` `tools/list` lists to the client; other tools and error answers stay `'both'`. |
|                | `'text'`           | The text content only. `tools/list` leaves `outputSchema` out for that client, so a client that checks `structuredContent` against the schema does not fail.                                                                                     |
| `annotations`  | `'no-numbers'`     | `resources/list` sends no numeric annotation (`priority`) on any resource, whatever `skillsConfig.resourceAnnotations` says.                                                                                                                     |
|                | `'full'`           | Each skill's `SKILL.md` resource gets `audience: ['assistant']` and `priority: 0.8`, as with `skillsConfig.resourceAnnotations: 'full'`.                                                                                                         |
| `instructions` | `'compact'`        | The `initialize` instructions carry the one-line skills count, as `skillsConfig.injectInstructions: 'compact'`.                                                                                                                                  |
|                | `'full'`           | The instructions carry the skill catalog, as `skillsConfig.injectInstructions: 'append'`.                                                                                                                                                        |

## How it applies

- `tools/call`: the `shapeAnswer` stage of `tools:call-tool` applies `structured`, after the answer budget (`fitAnswer`) and before the answer-cost counters (`meterAnswer`). A plugin can hook it. Answers with a UI widget, and answers a tool gets from `this.callTool()`, are left alone.
- The client name comes from the request (MCP 2026-07-28 clients send `clientInfo` with each request), else from the session's `initialize`. A client that sends no name matches no profile.
- Invalid profiles stop `@FrontMcp` at startup with `InvalidDecoratorMetadataError` (`@FrontMcp invalid metadata for "clients"`): an unknown field (`structure:`), an unknown value, or an empty key.

## Measuring the duplicate

With `metrics: { enabled: true }`, `/metrics` counts per tool and per client platform the bytes each answer takes, an estimate of its tokens (bytes / 4), and the bytes of text that repeat `structuredContent` (`frontmcp_tool_answer_duplicated_bytes_total`). Compare a client's counters before and after giving it a profile. See `frontmcp-observability` → `metrics-endpoint`.

## Verification Checklist

- [ ] Each key matches the name the client really sends (check the `initialize: received request` log line, `clientName`)
- [ ] A `structured: 'only'` client lists the tools first, so it knows each `outputSchema`
- [ ] A `structured: 'text'` client gets no `outputSchema` in `tools/list` and no `structuredContent` in answers
- [ ] `resources/list` for an `annotations: 'no-numbers'` client carries no `priority`

## Troubleshooting

| Problem                                               | Cause                                                                                                         | Solution                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| A profile never applies                               | The key does not match the client's `clientInfo.name`, or an earlier key matched first                        | Log the name at `initialize`; put the most specific keys first                  |
| `structured: 'only'` still sends the JSON text        | The tool has no `outputSchema`, `output.schemaMode` is `'none'` or `'description'`, or the answer is an error | Declare an object `outputSchema` listed as `'definition'` or `'both'`           |
| `@FrontMcp invalid metadata for "clients"` at startup | A misspelled field or value                                                                                   | Use `structured`, `annotations` and `instructions` with the values in the table |

## Examples

| Example                                                                                   | Level        | Description                                                                                   |
| ----------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------- |
| [`coding-agent-profiles`](../examples/configure-client-profiles/coding-agent-profiles.md) | Intermediate | Send coding agents one copy of each answer, and keep numbers out of one client's annotations. |

> See all examples in [`examples/configure-client-profiles/`](../examples/configure-client-profiles/)

## Reference

- Related skills: `configure-skills-http` (`resourceAnnotations`, `injectInstructions`), `configure-transport` (client platform detection), `create-tool` (`output-schema`: answer budget)
