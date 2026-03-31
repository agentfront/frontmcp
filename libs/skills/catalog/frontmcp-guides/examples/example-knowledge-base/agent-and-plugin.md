---
name: agent-and-plugin
reference: example-knowledge-base
level: advanced
description: 'Shows an autonomous research agent with inner tools and configurable depth, and a plugin that hooks into tool execution for audit logging.'
tags: [guides, knowledge-base, knowledge, base, agent, plugin]
features:
  - 'Agent with `@Agent` decorator, LLM config, inner tools, and system instructions'
  - 'Using `this.run(prompt, { maxIterations })` to execute the LLM tool-use loop'
  - "Configurable behavior via input schema (`depth: 'shallow' | 'deep'`)"
  - 'Plugin hooks: `onToolExecuteBefore`, `onToolExecuteAfter`, `onToolExecuteError`'
  - 'Using `ctx.state.set/get()` for flow state instead of mutating `rawInput`'
  - 'Non-blocking audit logging (`.catch()` prevents audit failures from breaking tools)'
---

# Knowledge Base: Research Agent and Audit Log Plugin

Shows an autonomous research agent with inner tools and configurable depth, and a plugin that hooks into tool execution for audit logging.

## Code

```typescript
// src/research/agents/researcher.agent.ts
import { Agent, AgentContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { SearchDocsTool } from '../../search/tools/search-docs.tool';
import { IngestDocumentTool } from '../../ingestion/tools/ingest-document.tool';

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
    model: 'claude-sonnet-4-20250514',
    apiKey: { env: 'ANTHROPIC_API_KEY' },
    maxTokens: 4096,
  },
  // Inner tools: the agent can call these during its execution
  tools: [SearchDocsTool, IngestDocumentTool],
  systemInstructions: `You are a research assistant with access to a knowledge base.
Your job is to:
1. Search the knowledge base for relevant documents using the search_docs tool.
2. Analyze the results and identify key themes.
3. If depth is "deep", perform multiple searches with refined queries.
4. Synthesize findings into a structured summary with source attribution.
Always cite which documents support your findings.`,
})
export class ResearcherAgent extends AgentContext {
  async execute(input: { topic: string; depth: 'shallow' | 'deep' }) {
    const maxIterations = input.depth === 'deep' ? 5 : 2;
    const prompt = [
      `Research the following topic: "${input.topic}"`,
      `Depth: ${input.depth} (max ${maxIterations} search iterations)`,
      'Search the knowledge base, analyze results, and produce a structured summary.',
      'Return your findings as JSON matching the output schema.',
    ].join('\n');

    // this.run() executes the LLM loop with inner tools
    return this.run(prompt, { maxIterations });
  }
}
```

```typescript
// src/plugins/audit-log.plugin.ts
import { Plugin } from '@frontmcp/sdk';
import type { PluginHookContext } from '@frontmcp/sdk';

@Plugin({
  name: 'AuditLog',
  description: 'Logs all tool invocations for audit compliance',
})
export class AuditLogPlugin {
  private readonly logs: Array<{
    timestamp: string;
    tool: string;
    userId: string | undefined;
    duration: number;
    success: boolean;
  }> = [];

  async onToolExecuteBefore(ctx: PluginHookContext): Promise<void> {
    // Store start time in flow state (not in rawInput)
    ctx.state.set('audit:startTime', Date.now());
  }

  async onToolExecuteAfter(ctx: PluginHookContext): Promise<void> {
    const startTime = ctx.state.get('audit:startTime') as number;
    const duration = Date.now() - startTime;

    const entry = {
      timestamp: new Date().toISOString(),
      tool: ctx.toolName,
      userId: ctx.session?.userId,
      duration,
      success: true,
    };
    this.logs.push(entry);

    // In production, send to an external logging service
    if (process.env.AUDIT_LOG_ENDPOINT) {
      await ctx
        .fetch(process.env.AUDIT_LOG_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry),
        })
        .catch(() => {
          // Audit logging should not block tool execution
        });
    }
  }

  async onToolExecuteError(ctx: PluginHookContext): Promise<void> {
    const startTime = ctx.state.get('audit:startTime') as number;
    const duration = Date.now() - startTime;

    this.logs.push({
      timestamp: new Date().toISOString(),
      tool: ctx.toolName,
      userId: ctx.session?.userId,
      duration,
      success: false,
    });
  }

  getLogs(): typeof this.logs {
    return [...this.logs];
  }
}
```

## What This Demonstrates

- Agent with `@Agent` decorator, LLM config, inner tools, and system instructions
- Using `this.run(prompt, { maxIterations })` to execute the LLM tool-use loop
- Configurable behavior via input schema (`depth: 'shallow' | 'deep'`)
- Plugin hooks: `onToolExecuteBefore`, `onToolExecuteAfter`, `onToolExecuteError`
- Using `ctx.state.set/get()` for flow state instead of mutating `rawInput`
- Non-blocking audit logging (`.catch()` prevents audit failures from breaking tools)

## Related

- See `example-knowledge-base` for the full knowledge base example with vector store and tests
