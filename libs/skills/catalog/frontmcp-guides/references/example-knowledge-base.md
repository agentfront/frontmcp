---
name: example-knowledge-base
description: Multi-app knowledge base with vector storage, semantic search, AI research agent, and audit plugin
---

# Example: Knowledge Base (Advanced)

> Skills used: setup-project, multi-app-composition, create-tool, create-resource, create-provider, create-agent, create-plugin, configure-auth, deploy-to-vercel

A multi-app knowledge base MCP server with three composed apps: document ingestion with vector storage, semantic search with resource templates, and an autonomous AI research agent. Includes a custom audit log plugin and demonstrates advanced patterns like multi-app composition, DI across app boundaries, agent inner tools, and plugin hooks.

---

## Server Entry Point

```typescript
// src/main.ts
import { FrontMcp } from '@frontmcp/sdk';

import { IngestionApp } from './ingestion/ingestion.app';
import { AuditLogPlugin } from './plugins/audit-log.plugin';
import { ResearchApp } from './research/research.app';
import { SearchApp } from './search/search.app';

@FrontMcp({
  info: { name: 'knowledge-base', version: '1.0.0' },
  apps: [IngestionApp, SearchApp, ResearchApp],
  plugins: [AuditLogPlugin],
  auth: { mode: 'remote', provider: 'https://auth.example.com', clientId: 'my-client-id' },
  redis: { provider: 'redis', host: process.env.REDIS_URL ?? 'localhost' },
})
export default class KnowledgeBaseServer {}
```

---

## Ingestion App

### App Registration

```typescript
// src/ingestion/ingestion.app.ts
import { App } from '@frontmcp/sdk';

import { VectorStoreProvider } from './providers/vector-store.provider';
import { IngestDocumentTool } from './tools/ingest-document.tool';

@App({
  name: 'Ingestion',
  description: 'Document ingestion and chunking pipeline',
  providers: [VectorStoreProvider],
  tools: [IngestDocumentTool],
})
export class IngestionApp {}
```

### Provider: Vector Store

This example uses the in-tree `vectoriadb` package (already a runtime dep in the SDK). The provider class is its own DI token — tools inject it via `this.get(VectorStoreProvider)`.

```typescript
// src/ingestion/providers/vector-store.provider.ts
import { FileStorageAdapter, VectoriaDB, type DocumentMetadata } from 'vectoriadb';

import { Provider, ProviderScope } from '@frontmcp/sdk';

export interface DocChunk extends DocumentMetadata {
  documentId: string;
  title: string;
  chunkIndex: number;
  content: string;
  tags: string;
}

@Provider({ name: 'vector-store', scope: ProviderScope.GLOBAL })
export class VectorStoreProvider {
  private readonly db: VectoriaDB<DocChunk>;
  private readonly ready: Promise<void>;

  constructor() {
    this.db = new VectoriaDB<DocChunk>({
      modelName: 'Xenova/all-MiniLM-L6-v2',
      cacheDir: './.cache/transformers',
      useHNSW: true,
      defaultSimilarityThreshold: 0.3,
      defaultTopK: 10,
      storageAdapter: new FileStorageAdapter({ cacheDir: './.cache/kb-vectors' }),
    });
    this.ready = this.db.initialize();
  }

  async upsert(chunks: Array<{ id: string; text: string; metadata: DocChunk }>): Promise<void> {
    await this.ready;
    await this.db.addMany(chunks);
    await this.db.saveToStorage();
  }

  async search(query: string, topK: number) {
    await this.ready;
    return this.db.search(query, { topK });
  }

  async getByDocumentId(documentId: string) {
    await this.ready;
    // VectoriaDB supports metadata filters via the `filter` predicate
    return this.db.search(documentId, {
      topK: 100,
      filter: (meta) => meta.documentId === documentId,
    });
  }

  async deleteByDocumentId(documentId: string): Promise<void> {
    await this.ready;
    const matches = await this.getByDocumentId(documentId);
    for (const match of matches) {
      this.db.remove(match.id);
    }
    await this.db.saveToStorage();
  }
}
```

### Tool: Ingest Document

VectoriaDB owns embedding generation, so the tool only chunks the text and hands raw strings to the provider.

```typescript
// src/ingestion/tools/ingest-document.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

import { VectorStoreProvider } from '../providers/vector-store.provider';

@Tool({
  name: 'ingest_document',
  description: 'Ingest a document by chunking its content and storing embeddings',
  inputSchema: {
    documentId: z.string().min(1).describe('Unique document identifier'),
    title: z.string().min(1).describe('Document title'),
    content: z.string().min(1).describe('Full document text content'),
    tags: z.array(z.string()).default([]).describe('Optional tags for filtering'),
  },
  outputSchema: {
    documentId: z.string(),
    chunksCreated: z.number(),
    title: z.string(),
  },
})
export class IngestDocumentTool extends ToolContext {
  async execute(input: { documentId: string; title: string; content: string; tags: string[] }) {
    const store = this.get(VectorStoreProvider);

    this.mark('chunking');
    const textChunks = this.chunkText(input.content, 512);

    this.mark('embedding');
    await this.progress(0, textChunks.length, 'Generating embeddings');

    const docs = textChunks.map((text, i) => ({
      id: `${input.documentId}-chunk-${i}`,
      text,
      metadata: {
        id: `${input.documentId}-chunk-${i}`,
        documentId: input.documentId,
        title: input.title,
        chunkIndex: i,
        content: text,
        tags: input.tags.join(','),
      },
    }));

    this.mark('storing');
    await store.upsert(docs);
    await this.progress(textChunks.length, textChunks.length, 'Stored');

    await this.notify(`Ingested "${input.title}" with ${docs.length} chunks`, 'info');

    return {
      documentId: input.documentId,
      chunksCreated: docs.length,
      title: input.title,
    };
  }

  private chunkText(text: string, maxTokens: number): string[] {
    const sentences = text.split(/(?<=[.!?])\s+/);
    const chunks: string[] = [];
    let current = '';

    for (const sentence of sentences) {
      if ((current + ' ' + sentence).trim().length > maxTokens * 4) {
        if (current) chunks.push(current.trim());
        current = sentence;
      } else {
        current = current ? current + ' ' + sentence : sentence;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
  }
}
```

---

## Search App

### App Registration

```typescript
// src/search/search.app.ts
import { App } from '@frontmcp/sdk';

import { VectorStoreProvider } from '../ingestion/providers/vector-store.provider';
import { DocResource } from './resources/doc.resource';
import { SearchDocsTool } from './tools/search-docs.tool';

@App({
  name: 'Search',
  description: 'Semantic search and document retrieval',
  providers: [VectorStoreProvider],
  tools: [SearchDocsTool],
  resources: [DocResource],
})
export class SearchApp {}
```

### Tool: Search Documents

```typescript
// src/search/tools/search-docs.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

import { VectorStoreProvider } from '../../ingestion/providers/vector-store.provider';

@Tool({
  name: 'search_docs',
  description: 'Semantic search across the knowledge base',
  inputSchema: {
    query: z.string().min(1).describe('Natural language search query'),
    topK: z.number().int().min(1).max(20).default(5).describe('Number of results'),
  },
  outputSchema: {
    results: z.array(
      z.object({
        documentId: z.string(),
        content: z.string(),
        score: z.number(),
        title: z.string(),
      }),
    ),
    total: z.number(),
  },
})
export class SearchDocsTool extends ToolContext {
  async execute(input: { query: string; topK: number }) {
    const store = this.get(VectorStoreProvider);

    // VectoriaDB handles embedding generation internally — pass the raw query.
    this.mark('searching');
    const matches = await store.search(input.query, input.topK);

    const results = matches.map((m) => ({
      documentId: m.metadata.documentId,
      content: m.metadata.content,
      score: m.score,
      title: m.metadata.title ?? 'Untitled',
    }));

    return { results, total: results.length };
  }
}
```

### Resource Template: Document by ID

```typescript
// src/search/resources/doc.resource.ts
import { ReadResourceResult, ResourceContext, ResourceNotFoundError, ResourceTemplate } from '@frontmcp/sdk';

import { VectorStoreProvider } from '../../ingestion/providers/vector-store.provider';

@ResourceTemplate({
  name: 'document',
  uriTemplate: 'kb://documents/{documentId}',
  description: 'Retrieve all chunks of a document by its ID',
  mimeType: 'application/json',
})
export class DocResource extends ResourceContext<{ documentId: string }> {
  async execute(uri: string, params: { documentId: string }): Promise<ReadResourceResult> {
    const store = this.get(VectorStoreProvider);
    const matches = await store.getByDocumentId(params.documentId);

    if (matches.length === 0) {
      // Use a typed MCP error so the protocol response carries the correct JSON-RPC code.
      throw new ResourceNotFoundError(uri);
    }

    const document = {
      documentId: params.documentId,
      title: matches[0].metadata.title ?? 'Untitled',
      chunks: matches
        .map((m) => ({ chunkIndex: m.metadata.chunkIndex, content: m.metadata.content }))
        .sort((a, b) => a.chunkIndex - b.chunkIndex),
    };

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(document, null, 2),
        },
      ],
    };
  }
}
```

---

## Research App

### App Registration

```typescript
// src/research/research.app.ts
import { App } from '@frontmcp/sdk';

import { ResearcherAgent } from './agents/researcher.agent';

@App({
  name: 'Research',
  description: 'AI-powered research agent for knowledge synthesis',
  agents: [ResearcherAgent],
})
export class ResearchApp {}
```

### Agent: Researcher

The framework drives the LLM tool-use loop via the `agents:call-agent` flow — the agent class doesn't override `execute()`. Configure iteration limits via `@Agent({ execution: { maxIterations } })`.

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
    provider: 'anthropic', // Any supported provider — 'anthropic', 'openai', etc.
    model: 'claude-sonnet-4-6', // Any supported model for the chosen provider
    apiKey: { env: 'ANTHROPIC_API_KEY' },
    maxTokens: 4096,
  },
  // Cap the inner tool-use loop. The framework — not your code — drives iteration.
  execution: { maxIterations: 5 },
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

---

## Plugin: Audit Log

Real plugins extend `DynamicPlugin<Options>` and attach to flows via the `FlowHooksOf` decorators (e.g. `@ToolHook.Will('execute')`, `@ToolHook.Did('execute')`). There is no `PluginHookContext`/`onToolExecute*` lifecycle.

```typescript
// src/plugins/audit-log.plugin.ts
import { DynamicPlugin, FlowCtxOf, Plugin, ToolHook } from '@frontmcp/sdk';

export interface AuditLogPluginOptions {
  endpoint?: string;
}

@Plugin({
  name: 'audit-log',
  description: 'Logs all tool invocations for audit compliance',
})
export default class AuditLogPlugin extends DynamicPlugin<AuditLogPluginOptions> {
  private readonly logs: Array<{
    timestamp: string;
    tool: string;
    userId: string | undefined;
    duration: number;
    success: boolean;
  }> = [];

  constructor(protected options: AuditLogPluginOptions = {}) {
    super();
  }

  // `Will('execute')` runs immediately before the tool's execute() — record start time on the flow state.
  @ToolHook.Will('execute', { priority: 100 })
  async onWillExecute(flowCtx: FlowCtxOf<'tools:call-tool'>): Promise<void> {
    flowCtx.state.set('audit:startTime', Date.now());
  }

  // `Did('execute')` runs after a successful execute() — compute duration and log success.
  @ToolHook.Did('execute', { priority: 100 })
  async onDidExecute(flowCtx: FlowCtxOf<'tools:call-tool'>): Promise<void> {
    const startTime = flowCtx.state.get('audit:startTime') as number | undefined;
    const duration = startTime ? Date.now() - startTime : 0;
    const ctx = flowCtx.state.required.toolContext;

    const entry = {
      timestamp: new Date().toISOString(),
      tool: ctx.metadata.name,
      userId: (ctx.authInfo as any)?.user?.sub as string | undefined,
      duration,
      success: true,
    };
    this.logs.push(entry);

    if (this.options.endpoint) {
      // Audit logging should never block tool execution.
      await ctx
        .fetch(this.options.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry),
        })
        .catch(() => undefined);
    }
  }

  // `Around('execute')` wraps the call so we can capture errors as well.
  @ToolHook.Around('execute', { priority: 100 })
  async aroundExecute(flowCtx: FlowCtxOf<'tools:call-tool'>, next: () => Promise<unknown>): Promise<unknown> {
    try {
      return await next();
    } catch (err) {
      const startTime = flowCtx.state.get('audit:startTime') as number | undefined;
      const ctx = flowCtx.state.required.toolContext;
      this.logs.push({
        timestamp: new Date().toISOString(),
        tool: ctx.metadata.name,
        userId: (ctx.authInfo as any)?.user?.sub as string | undefined,
        duration: startTime ? Date.now() - startTime : 0,
        success: false,
      });
      throw err;
    }
  }

  getLogs(): ReadonlyArray<(typeof this.logs)[number]> {
    return [...this.logs];
  }
}
```

---

## Test: Researcher Agent

The agent class has no `execute()` to unit-test — the framework drives the LLM tool-use loop via the `agents:call-agent` flow. Cover the agent end-to-end: register it on a `TestServer`, call it via `client.tools.call('research_topic', ...)` (agents are exposed as tools), and assert on the structured output.

```typescript
// test/researcher.agent.e2e.spec.ts
import { McpTestClient, TestServer, TestTokenFactory } from '@frontmcp/testing';

describe('ResearcherAgent E2E', () => {
  let client: McpTestClient;
  let server: TestServer;

  beforeAll(async () => {
    server = await TestServer.start({ command: 'npx tsx src/main.ts' });
    const token = await new TestTokenFactory().createTestToken({ sub: 'researcher-1', scopes: ['kb'] });
    client = await McpTestClient.create({ baseUrl: server.info.baseUrl }).withToken(token).buildAndConnect();
  });

  afterAll(async () => {
    await client.disconnect();
    await server.stop();
  });

  it('exposes the research_topic agent in the tool list', async () => {
    const tools = await client.tools.list();
    expect(tools.map((t) => t.name)).toContain('research_topic');
  });
});
```

---

## Test: Audit Log Plugin

Test the hook methods directly with a minimal `FlowCtx` shape. The `state` object is a `Map`-like store and `state.required.toolContext` is the live `ToolContext` exposed to hooks.

```typescript
// test/audit-log.plugin.spec.ts
import type { FlowCtxOf } from '@frontmcp/sdk';

import AuditLogPlugin from '../src/plugins/audit-log.plugin';

type ToolFlowCtx = FlowCtxOf<'tools:call-tool'>;

function makeFlowCtx(toolName: string, userSub: string | undefined): ToolFlowCtx {
  const map = new Map<string, unknown>();
  const toolContext = {
    metadata: { name: toolName },
    authInfo: userSub ? { user: { sub: userSub } } : {},
    fetch: jest.fn().mockResolvedValue(new Response(null, { status: 204 })),
  };
  return {
    state: {
      set: (k: string, v: unknown) => map.set(k, v),
      get: (k: string) => map.get(k),
      required: { toolContext },
    },
    rawInput: {},
  } as unknown as ToolFlowCtx;
}

describe('AuditLogPlugin', () => {
  it('records a successful tool execution', async () => {
    const plugin = new AuditLogPlugin();
    const flowCtx = makeFlowCtx('search_docs', 'user-1');

    await plugin.onWillExecute(flowCtx);
    await plugin.onDidExecute(flowCtx);

    const logs = plugin.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].tool).toBe('search_docs');
    expect(logs[0].success).toBe(true);
    expect(logs[0].userId).toBe('user-1');
    expect(logs[0].duration).toBeGreaterThanOrEqual(0);
  });

  it('records a failed tool execution via aroundExecute', async () => {
    const plugin = new AuditLogPlugin();
    const flowCtx = makeFlowCtx('ingest_document', undefined);

    await plugin.onWillExecute(flowCtx);
    const failing = () => Promise.reject(new Error('boom'));

    await expect(plugin.aroundExecute(flowCtx, failing)).rejects.toThrow('boom');

    const logs = plugin.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].success).toBe(false);
    expect(logs[0].userId).toBeUndefined();
  });
});
```

## Examples

| Example                                                                                            | Level        | Description                                                                                                                                   |
| -------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [`agent-and-plugin`](../examples/example-knowledge-base/agent-and-plugin.md)                       | Advanced     | Shows an autonomous research agent with inner tools and configurable depth, and a plugin that hooks into tool execution for audit logging.    |
| [`multi-app-composition`](../examples/example-knowledge-base/multi-app-composition.md)             | Basic        | Shows how to compose multiple apps (Ingestion, Search, Research) into a single server with shared providers, plugins, and agent registration. |
| [`vector-search-and-resources`](../examples/example-knowledge-base/vector-search-and-resources.md) | Intermediate | Shows a semantic search tool with embedding generation and a resource template for retrieving documents by ID using URI parameters.           |

> See all examples in [`examples/example-knowledge-base/`](../examples/example-knowledge-base/)
