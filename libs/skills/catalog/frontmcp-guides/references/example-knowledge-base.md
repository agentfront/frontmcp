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

```typescript
// src/ingestion/providers/vector-store.provider.ts
import type { Token } from '@frontmcp/di';
import { Provider } from '@frontmcp/sdk';

export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  embedding: number[];
  metadata: Record<string, string>;
}

export interface VectorStore {
  upsert(chunks: DocumentChunk[]): Promise<void>;
  search(embedding: number[], topK: number): Promise<DocumentChunk[]>;
  getByDocumentId(documentId: string): Promise<DocumentChunk[]>;
  deleteByDocumentId(documentId: string): Promise<void>;
}

export const VECTOR_STORE: Token<VectorStore> = Symbol('VectorStore');

@Provider({ token: VECTOR_STORE })
export class VectorStoreProvider implements VectorStore {
  private client!: { upsert: Function; query: Function; delete: Function };

  async onInit(): Promise<void> {
    const apiKey = process.env.VECTOR_DB_API_KEY;
    if (!apiKey) {
      throw new Error('VECTOR_DB_API_KEY environment variable is required');
    }

    // Initialize your vector DB client (e.g., Pinecone, Weaviate, Qdrant)
    this.client = await this.createVectorClient(apiKey);
  }

  async upsert(chunks: DocumentChunk[]): Promise<void> {
    await this.client.upsert(
      chunks.map((c) => ({
        id: c.id,
        values: c.embedding,
        metadata: { ...c.metadata, documentId: c.documentId, content: c.content },
      })),
    );
  }

  async search(embedding: number[], topK: number): Promise<DocumentChunk[]> {
    const results = await this.client.query({ vector: embedding, topK });
    return results.matches.map((m: Record<string, unknown>) => ({
      id: m.id as string,
      documentId: (m.metadata as Record<string, string>).documentId,
      content: (m.metadata as Record<string, string>).content,
      embedding: m.values as number[],
      metadata: m.metadata as Record<string, string>,
    }));
  }

  async getByDocumentId(documentId: string): Promise<DocumentChunk[]> {
    const results = await this.client.query({
      filter: { documentId },
      topK: 100,
      vector: new Array(1536).fill(0),
    });
    return results.matches.map((m: Record<string, unknown>) => ({
      id: m.id as string,
      documentId,
      content: (m.metadata as Record<string, string>).content,
      embedding: m.values as number[],
      metadata: m.metadata as Record<string, string>,
    }));
  }

  async deleteByDocumentId(documentId: string): Promise<void> {
    await this.client.delete({ filter: { documentId } });
  }

  private async createVectorClient(_apiKey: string): Promise<{ upsert: Function; query: Function; delete: Function }> {
    // Stub: replace with your vector DB SDK (e.g., Pinecone, Weaviate, Qdrant)
    // This placeholder focuses on the FrontMCP patterns, not the vector DB integration.
    throw new Error('Implement with your vector DB provider (e.g., Pinecone, Weaviate, Qdrant)');
  }
}
```

### Tool: Ingest Document

```typescript
// src/ingestion/tools/ingest-document.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

import { VECTOR_STORE, type DocumentChunk } from '../providers/vector-store.provider';

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
    const store = this.get(VECTOR_STORE);

    this.mark('chunking');
    const textChunks = this.chunkText(input.content, 512);

    this.mark('embedding');
    await this.respondProgress(0, textChunks.length);

    const chunks: DocumentChunk[] = [];
    for (let i = 0; i < textChunks.length; i++) {
      const embedding = await this.generateEmbedding(textChunks[i]);
      chunks.push({
        id: `${input.documentId}-chunk-${i}`,
        documentId: input.documentId,
        content: textChunks[i],
        embedding,
        metadata: { title: input.title, tags: input.tags.join(','), chunkIndex: String(i) },
      });
      await this.respondProgress(i + 1, textChunks.length);
    }

    this.mark('storing');
    await store.upsert(chunks);

    await this.notify(`Ingested "${input.title}" with ${chunks.length} chunks`, 'info');

    return {
      documentId: input.documentId,
      chunksCreated: chunks.length,
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

  private async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ input: text, model: 'text-embedding-3-small' }),
    });
    const data = await response.json();
    return data.data[0].embedding;
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

import { VECTOR_STORE } from '../../ingestion/providers/vector-store.provider';

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
    const store = this.get(VECTOR_STORE);

    this.mark('embedding-query');
    const queryEmbedding = await this.generateQueryEmbedding(input.query);

    this.mark('searching');
    const chunks = await store.search(queryEmbedding, input.topK);

    const results = chunks.map((chunk) => ({
      documentId: chunk.documentId,
      content: chunk.content,
      score: chunk.metadata.score ? parseFloat(chunk.metadata.score) : 0,
      title: chunk.metadata.title ?? 'Untitled',
    }));

    return { results, total: results.length };
  }

  private async generateQueryEmbedding(query: string): Promise<number[]> {
    const response = await this.fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ input: query, model: 'text-embedding-3-small' }),
    });
    const data = await response.json();
    return data.data[0].embedding;
  }
}
```

### Resource Template: Document by ID

```typescript
// src/search/resources/doc.resource.ts
import type { ReadResourceResult } from '@frontmcp/protocol';
import { ResourceContext, ResourceTemplate } from '@frontmcp/sdk';

import { VECTOR_STORE } from '../../ingestion/providers/vector-store.provider';

@ResourceTemplate({
  name: 'document',
  uriTemplate: 'kb://documents/{documentId}',
  description: 'Retrieve all chunks of a document by its ID',
  mimeType: 'application/json',
})
export class DocResource extends ResourceContext<{ documentId: string }> {
  async execute(uri: string, params: { documentId: string }): Promise<ReadResourceResult> {
    const store = this.get(VECTOR_STORE);
    const chunks = await store.getByDocumentId(params.documentId);

    if (chunks.length === 0) {
      this.fail(new Error(`Document not found: ${params.documentId}`));
    }

    const document = {
      documentId: params.documentId,
      title: chunks[0].metadata.title ?? 'Untitled',
      chunks: chunks.map((c) => ({
        chunkIndex: c.metadata.chunkIndex,
        content: c.content,
      })),
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
    model: 'claude-sonnet-4-20250514', // Any supported model for the chosen provider
    apiKey: { env: 'ANTHROPIC_API_KEY' },
    maxTokens: 4096,
  },
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

    return this.run(prompt, { maxIterations });
  }
}
```

---

## Plugin: Audit Log

```typescript
// src/plugins/audit-log.plugin.ts
import { Plugin, type PluginHookContext } from '@frontmcp/sdk';

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

---

## Test: Researcher Agent

```typescript
// test/researcher.agent.spec.ts
import { AgentContext } from '@frontmcp/sdk';

import { ResearcherAgent } from '../src/research/agents/researcher.agent';

describe('ResearcherAgent', () => {
  let agent: ResearcherAgent;

  beforeEach(() => {
    agent = new ResearcherAgent();
  });

  it('should configure shallow depth with 2 max iterations', async () => {
    const runFn = jest.fn().mockResolvedValue({
      topic: 'TypeScript patterns',
      summary: 'Key patterns include generics and type guards.',
      sources: [{ documentId: 'doc-1', title: 'TS Handbook', relevance: 'high' }],
      confidence: 'medium',
    });

    const ctx = {
      run: runFn,
      get: jest.fn(),
      tryGet: jest.fn(),
      fail: jest.fn((err: Error) => {
        throw err;
      }),
      mark: jest.fn(),
      notify: jest.fn(),
      respondProgress: jest.fn(),
    } as unknown as AgentContext;
    Object.assign(agent, ctx);

    const result = await agent.execute({
      topic: 'TypeScript patterns',
      depth: 'shallow',
    });

    expect(runFn).toHaveBeenCalledWith(expect.stringContaining('TypeScript patterns'), { maxIterations: 2 });
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('sources');
    expect(result.confidence).toBe('medium');
  });

  it('should configure deep depth with 5 max iterations', async () => {
    const runFn = jest.fn().mockResolvedValue({
      topic: 'Distributed systems',
      summary: 'Consensus, replication, and partition tolerance.',
      sources: [],
      confidence: 'low',
    });

    const ctx = {
      run: runFn,
      get: jest.fn(),
      tryGet: jest.fn(),
      fail: jest.fn((err: Error) => {
        throw err;
      }),
      mark: jest.fn(),
      notify: jest.fn(),
      respondProgress: jest.fn(),
    } as unknown as AgentContext;
    Object.assign(agent, ctx);

    await agent.execute({ topic: 'Distributed systems', depth: 'deep' });

    expect(runFn).toHaveBeenCalledWith(expect.stringContaining('Distributed systems'), { maxIterations: 5 });
  });
});
```

---

## Test: Audit Log Plugin

```typescript
// test/audit-log.plugin.spec.ts
import type { PluginHookContext } from '@frontmcp/sdk';

import { AuditLogPlugin } from '../src/plugins/audit-log.plugin';

describe('AuditLogPlugin', () => {
  let plugin: AuditLogPlugin;

  beforeEach(() => {
    plugin = new AuditLogPlugin();
  });

  it('should record a successful tool execution', async () => {
    const state = new Map<string, unknown>();
    const ctx = {
      toolName: 'search_docs',
      session: { userId: 'user-1' },
      state: { set: (k: string, v: unknown) => state.set(k, v), get: (k: string) => state.get(k) },
      fetch: jest.fn(),
    } as unknown as PluginHookContext;

    await plugin.onToolExecuteBefore(ctx);
    await plugin.onToolExecuteAfter(ctx);

    const logs = plugin.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].tool).toBe('search_docs');
    expect(logs[0].success).toBe(true);
    expect(logs[0].userId).toBe('user-1');
    expect(logs[0].duration).toBeGreaterThanOrEqual(0);
  });

  it('should record a failed tool execution', async () => {
    const state = new Map<string, unknown>();
    const ctx = {
      toolName: 'ingest_document',
      session: undefined,
      state: { set: (k: string, v: unknown) => state.set(k, v), get: (k: string) => state.get(k) },
      fetch: jest.fn(),
    } as unknown as PluginHookContext;

    await plugin.onToolExecuteBefore(ctx);
    await plugin.onToolExecuteError(ctx);

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
