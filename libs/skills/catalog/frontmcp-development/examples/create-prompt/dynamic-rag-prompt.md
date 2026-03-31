---
name: dynamic-rag-prompt
reference: create-prompt
level: advanced
description: 'A prompt that queries a knowledge base via DI to build context-aware messages at runtime.'
tags: [development, prompt, dynamic, rag]
features:
  - 'Performing async operations (knowledge base search) inside `execute()` to generate context-aware prompts'
  - 'Resolving a DI provider via `this.get(KNOWLEDGE_BASE)` for service access'
  - 'Using `this.mark(stage)` for execution stage tracking in complex prompt generation'
  - 'Building dynamic message content from external data sources at runtime'
---

# Dynamic RAG Prompt with Dependency Injection

A prompt that queries a knowledge base via DI to build context-aware messages at runtime.

## Code

```typescript
// src/apps/main/tokens.ts
import type { Token } from '@frontmcp/di';

export interface KnowledgeBase {
  search(query: string, limit: number): Promise<Array<{ title: string; content: string }>>;
}

export const KNOWLEDGE_BASE: Token<KnowledgeBase> = Symbol('knowledge-base');
```

```typescript
// src/apps/main/prompts/rag-query.prompt.ts
import { Prompt, PromptContext } from '@frontmcp/sdk';
import { GetPromptResult } from '@frontmcp/protocol';
import { KNOWLEDGE_BASE } from '../tokens';

@Prompt({
  name: 'rag-query',
  description: 'Answer a question using knowledge base context',
  arguments: [
    { name: 'question', description: 'The question to answer', required: true },
    { name: 'maxSources', description: 'Maximum number of sources to include', required: false },
  ],
})
class RagQueryPrompt extends PromptContext {
  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    this.mark('search');
    const kb = this.get(KNOWLEDGE_BASE);
    const maxSources = parseInt(args.maxSources ?? '3', 10);
    const sources = await kb.search(args.question, maxSources);

    this.mark('compose');
    const contextBlock = sources.map((s, i) => `### Source ${i + 1}: ${s.title}\n${s.content}`).join('\n\n');

    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Answer the following question using only the provided sources. If the sources do not contain enough information, say so clearly.\n\n**Question:** ${args.question}\n\n---\n\n${contextBlock}`,
          },
        },
      ],
    };
  }
}
```

```typescript
// src/apps/main/index.ts
import { App } from '@frontmcp/sdk';

@App({
  name: 'main',
  providers: [KnowledgeBaseProvider],
  prompts: [RagQueryPrompt],
})
class MainApp {}
```

## What This Demonstrates

- Performing async operations (knowledge base search) inside `execute()` to generate context-aware prompts
- Resolving a DI provider via `this.get(KNOWLEDGE_BASE)` for service access
- Using `this.mark(stage)` for execution stage tracking in complex prompt generation
- Building dynamic message content from external data sources at runtime

## Related

- See `create-prompt` for resource embedding, function-style builders, and error handling with `this.fail()`
- See `create-provider` for implementing the `KnowledgeBaseProvider`
