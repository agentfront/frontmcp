---
name: multi-app-composition
reference: example-knowledge-base
level: basic
description: 'Shows how to compose multiple apps (Ingestion, Search, Research) into a single server with shared providers, plugins, and agent registration.'
tags: [guides, multi-app, knowledge-base, knowledge, base, multi]
features:
  - 'Composing three apps into one server: Ingestion (tools + providers), Search (tools + resources), Research (agents)'
  - 'Sharing providers across apps (VectorStoreProvider used by both Ingestion and Search)'
  - 'Registering plugins at the server level (AuditLogPlugin applies to all tools)'
  - 'Registering agents in a dedicated app for AI-powered features'
---

# Knowledge Base: Multi-App Composition

Shows how to compose multiple apps (Ingestion, Search, Research) into a single server with shared providers, plugins, and agent registration.

## Code

```typescript
// src/main.ts
import { FrontMcp } from '@frontmcp/sdk';
import { IngestionApp } from './ingestion/ingestion.app';
import { SearchApp } from './search/search.app';
import { ResearchApp } from './research/research.app';
import { AuditLogPlugin } from './plugins/audit-log.plugin';

@FrontMcp({
  info: { name: 'knowledge-base', version: '1.0.0' },
  apps: [IngestionApp, SearchApp, ResearchApp],
  plugins: [AuditLogPlugin],
  auth: { mode: 'remote', provider: 'https://auth.example.com', clientId: 'my-client-id' },
  redis: { provider: 'redis', host: process.env.REDIS_URL ?? 'localhost' },
})
export default class KnowledgeBaseServer {}
```

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

```typescript
// src/search/search.app.ts
import { App } from '@frontmcp/sdk';
import { VectorStoreProvider } from '../ingestion/providers/vector-store.provider';
import { SearchDocsTool } from './tools/search-docs.tool';
import { DocResource } from './resources/doc.resource';

@App({
  name: 'Search',
  description: 'Semantic search and document retrieval',
  providers: [VectorStoreProvider],
  tools: [SearchDocsTool],
  resources: [DocResource],
})
export class SearchApp {}
```

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

## What This Demonstrates

- Composing three apps into one server: Ingestion (tools + providers), Search (tools + resources), Research (agents)
- Sharing providers across apps (VectorStoreProvider used by both Ingestion and Search)
- Registering plugins at the server level (AuditLogPlugin applies to all tools)
- Registering agents in a dedicated app for AI-powered features

## Related

- See `example-knowledge-base` for the full knowledge base example with vector store, search, and agent code
