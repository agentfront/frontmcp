---
name: coding-agent-profiles
reference: configure-client-profiles
level: intermediate
description: "Send coding agents one copy of each answer, and keep numbers out of one client's annotations."
tags: [config, clients, codex, claude-code, structured-content, metrics]
features:
  - 'Matching clients by a glob of their `clientInfo.name`, first match wins'
  - 'Sending Codex the text content only, with no `outputSchema` in its `tools/list`'
  - 'Sending Claude Code `structuredContent` with a one-line summary as the text'
  - 'Dropping numeric resource annotations for one client'
  - 'Checking the saved bytes with the answer-cost counters on `/metrics`'
---

# Coding Agent Profiles

Send coding agents one copy of each answer, and keep numbers out of one client's annotations.

## Code

```typescript
// src/server.ts
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'list_builds',
  inputSchema: { limit: z.number().int().max(500).default(100) },
  outputSchema: { builds: z.array(z.object({ id: z.string(), status: z.string() })), total: z.number() },
})
class ListBuildsTool extends ToolContext {
  async execute({ limit }: { limit: number }) {
    const builds = Array.from({ length: limit }, (_, index) => ({ id: `b${index}`, status: 'passed' }));
    return { builds, total: builds.length };
  }
}

@App({ name: 'ci', tools: [ListBuildsTool] })
class CiApp {}

@FrontMcp({
  info: { name: 'ci', version: '1.0.0' },
  apps: [CiApp],
  clients: {
    // OpenAI Codex sends 'codex-mcp-client'; older versions 'Codex'
    'codex*': { structured: 'text' },
    // Claude Code sends 'claude-code'
    'claude-code': { structured: 'only' },
    'rust-mcp-*': { annotations: 'no-numbers' },
  },
  metrics: { enabled: true },
})
class Server {}
```

A `list_builds` call with `{ "limit": 2 }` from Claude Code is answered with:

```json
{
  "content": [{ "type": "text", "text": "The answer is in structuredContent: builds (2 items), total: 2." }],
  "structuredContent": {
    "builds": [
      { "id": "b0", "status": "passed" },
      { "id": "b1", "status": "passed" }
    ],
    "total": 2
  }
}
```

```bash
curl -s http://localhost:3000/metrics | grep frontmcp_tool_answer_duplicated_bytes_total
# frontmcp_tool_answer_duplicated_bytes_total{client="claude-code",tool="ci:list_builds"} 0
```

## What This Demonstrates

- Matching clients by a glob of their `clientInfo.name`, first match wins
- Sending Codex the text content only, with no `outputSchema` in its `tools/list`
- Sending Claude Code `structuredContent` with a one-line summary as the text
- Dropping numeric resource annotations for one client
- Checking the saved bytes with the answer-cost counters on `/metrics`

## Related

- See `configure-client-profiles` for every profile field
- See `metrics-endpoint` in `frontmcp-observability` for the answer-cost counters
