---
name: agent-and-plugin
reference: example-knowledge-base
level: advanced
description: Shows an autonomous research agent with inner tools and a real `ToolHook`-based plugin that hooks into the `tools:call-tool` flow for audit logging.
tags:
  - guides
  - knowledge-base
  - knowledge
  - base
  - agent
  - plugin
features:
  - Agent with `@Agent` decorator, LLM config, inner tools, and system instructions
  - 'Configuring the inner-loop limit via `@Agent({ execution: { maxIterations } })` (framework drives iteration; no `this.run(...)`)'
  - 'Plugin built on a real `ToolHook` decorator: one `@ToolHook.Around("execute")` hook that sees the start, the end and any error'
  - Keeping the start time in a local variable across `await next()` (the flow state accepts only its declared keys)
  - Using `flowCtx.state.required.toolContext` to read tool metadata and authInfo inside hooks
  - Non-blocking audit logging (`.catch()` prevents audit failures from breaking tools)
---

# Knowledge Base: Research Agent and Audit Log Plugin

Shows an autonomous research agent with inner tools and a real `ToolHook`-based plugin that hooks into the `tools:call-tool` flow for audit logging.

## Code

```typescript
// src/research/agents/researcher.agent.ts
import { Agent, AgentContext, z } from '@frontmcp/sdk';

import { IngestDocumentTool } from '../../ingestion/tools/ingest-document.tool';
import { SearchDocsTool } from '../../search/tools/search-docs.tool';

@Agent({
  name: 'research_topic',
  description: 'Research a topic across the knowledge base and synthesize findings into a structured report',
  inputSchema: {
    topic: z.string().min(1).describe('Research topic or question'),
    depth: z.enum(['shallow', 'deep']).default('shallow').describe('Research depth'),
  },
  outputSchema: {
    topic: z.string(),
    summary: z.string(),
    sources: z.array(
      z.object({
        documentId: z.string(),
        title: z.string(),
        relevance: z.string(),
      }),
    ),
    confidence: z.enum(['low', 'medium', 'high']),
  },
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    apiKey: { env: 'ANTHROPIC_API_KEY' },
    maxTokens: 4096,
  },
  // Cap the inner tool-use loop. The framework — not your code — drives iteration.
  execution: { maxIterations: 5 },
  // Inner tools: the agent can call these during its execution.
  tools: [SearchDocsTool, IngestDocumentTool],
  systemInstructions: `You are a research assistant with access to a knowledge base.
Your job is to:
1. Search the knowledge base for relevant documents using the search_docs tool.
2. Analyze the results and identify key themes.
3. When depth is "deep", perform multiple searches with refined queries; for "shallow", a single search is enough.
4. Synthesize findings into a structured summary with source attribution.
Always cite which documents support your findings, and return JSON matching the output schema.`,
})
export class ResearcherAgent extends AgentContext {}
```

```typescript
// src/plugins/audit-log.plugin.ts
import { DynamicPlugin, FlowCtxOf, Plugin, ToolHook } from '@frontmcp/sdk';

export interface AuditLogPluginOptions {
  endpoint?: string;
}

export interface AuditLogEntry {
  timestamp: string;
  tool: string;
  userId: string | undefined;
  duration: number;
  success: boolean;
}

@Plugin({
  name: 'audit-log',
  description: 'Logs all tool invocations for audit compliance',
})
export default class AuditLogPlugin extends DynamicPlugin<AuditLogPluginOptions> {
  private readonly logs: AuditLogEntry[] = [];

  constructor(protected options: AuditLogPluginOptions = {}) {
    super();
  }

  // Around('execute') wraps the tool's execute(): the start time is a local variable, so each call keeps its own.
  @ToolHook.Around('execute', { priority: 100 })
  async aroundExecute(flowCtx: FlowCtxOf<'tools:call-tool'>, next: () => Promise<void>): Promise<void> {
    const startTime = Date.now();
    let success = false;
    try {
      await next();
      success = true;
    } finally {
      this.record(flowCtx, Date.now() - startTime, success);
    }
  }

  getLogs(): ReadonlyArray<AuditLogEntry> {
    return [...this.logs];
  }

  private record(flowCtx: FlowCtxOf<'tools:call-tool'>, duration: number, success: boolean): void {
    const ctx = flowCtx.state.required.toolContext;
    const entry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      tool: ctx.metadata.name,
      userId: ctx.authInfo.user?.sub,
      duration,
      success,
    };
    this.logs.push(entry);

    if (this.options.endpoint) {
      // Audit logging should never block or fail the tool call — fire-and-forget.
      void ctx
        .fetch(this.options.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry),
        })
        .catch(() => undefined);
    }
  }
}
```

## What This Demonstrates

- Agent with `@Agent` decorator, LLM config, inner tools, and system instructions
- Configuring the inner-loop limit via `@Agent({ execution: { maxIterations } })` (framework drives iteration; no `this.run(...)`)
- Plugin built on a real `ToolHook` decorator: one `@ToolHook.Around("execute")` hook that sees the start, the end and any error
- Keeping the start time in a local variable across `await next()` (the flow state accepts only its declared keys)
- Using `flowCtx.state.required.toolContext` to read tool metadata and authInfo inside hooks
- Non-blocking audit logging (`.catch()` prevents audit failures from breaking tools)

## Related

- See `example-knowledge-base` for the full knowledge base example with vector store and tests
