---
name: agent-nested-tracing
reference: telemetry-api
level: advanced
description: "Trace an agent's execution lifecycle including its nested tool calls. Every span shares the same trace ID."
tags: [telemetry, agent, nested, tools, trace-id]
features:
  - 'Agent span wraps the entire execution (including LLM loop)'
  - 'Nested tool calls automatically get their own spans'
  - 'All spans share the same trace ID for end-to-end visibility'
  - 'this.telemetry works identically in agents and tools'
---

# Agent Nested Tracing

Trace an agent's execution lifecycle including its nested tool calls. Every span shares the same trace ID.

## Code

```typescript
// src/apps/research/agents/research.agent.ts
import { Agent, AgentContext } from '@frontmcp/sdk';
import { WebSearchTool } from '../tools/web-search.tool';
import { SummarizerTool } from '../tools/summarizer.tool';

@Agent({
  name: 'research_agent',
  description: 'Research a topic using web search and summarization',
  systemInstructions: 'You are a research assistant. Search for information, then summarize.',
  tools: [WebSearchTool, SummarizerTool],
})
export class ResearchAgent extends AgentContext {
  async execute(input: { query: string }) {
    // Event on the "agent research_agent" span
    this.telemetry.addEvent('research-started', {
      query: input.query,
      tools: 'web_search, summarize',
    });

    // The agent loop calls tools automatically.
    // Each tool call gets its own span under this agent's span.
    const result = await super.execute(input);

    this.telemetry.setAttributes({
      'research.iterations': 3,
      'research.sources': 5,
    });

    return result;
  }
}
```

Result in the trace:

```
RPC Span: "agents/call"
  └── Agent Span: "agent research_agent"
        ├── event: research-started (query=..., tools=...)
        ├── attribute: research.iterations=3
        │
        ├── RPC Span: "tools/call"
        │     └── Tool Span: "tool web_search"
        │           └── HTTP Client Span: "GET" (search API)
        │
        ├── RPC Span: "tools/call"
        │     └── Tool Span: "tool web_search"
        │           └── HTTP Client Span: "GET" (another query)
        │
        └── RPC Span: "tools/call"
              └── Tool Span: "tool summarize"

All spans share traceId = "abcdef1234567890..."
```

## What This Demonstrates

- Agent span wraps the entire execution (including LLM loop)
- Nested tool calls automatically get their own spans
- All spans share the same trace ID for end-to-end visibility
- this.telemetry works identically in agents and tools

## Related

- See `telemetry-api` for the full API reference
- See `frontmcp-development` for building agents
