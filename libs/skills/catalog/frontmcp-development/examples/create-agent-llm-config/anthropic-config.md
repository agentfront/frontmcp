---
name: anthropic-config
reference: create-agent-llm-config
level: basic
description: 'Configuring an agent with the Anthropic provider and common model options.'
tags: [development, anthropic, llm, agent, config]
features:
  - "Setting `provider: 'anthropic'` with a supported model (`claude-sonnet-4-20250514` or `claude-opus-4-20250514`)"
  - "Using `{ env: 'ANTHROPIC_API_KEY' }` to read the API key from an environment variable"
  - 'Setting `maxTokens` at the LLM config level and overriding per-call via `this.completion()` options'
  - 'Passing `temperature` as a per-call option for controlling response creativity'
---

# Anthropic LLM Configuration

Configuring an agent with the Anthropic provider and common model options.

## Code

```typescript
// src/apps/main/agents/summarizer.agent.ts
import { Agent, AgentContext, z } from '@frontmcp/sdk';

@Agent({
  name: 'summarizer',
  description: 'Summarizes text using Anthropic Claude',
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    apiKey: { env: 'ANTHROPIC_API_KEY' },
    maxTokens: 4096,
  },
  inputSchema: {
    text: z.string().describe('Text to summarize'),
  },
})
class SummarizerAgent extends AgentContext {
  async execute(input: { text: string }) {
    const result = await this.completion(
      {
        messages: [{ role: 'user', content: `Summarize this text:\n${input.text}` }],
      },
      {
        maxTokens: 500,
        temperature: 0.3,
      },
    );

    return result.content;
  }
}
```

```typescript
// For the most capable model:
@Agent({
  name: 'complex_reasoner',
  description: 'Handles complex reasoning tasks',
  llm: {
    provider: 'anthropic',
    model: 'claude-opus-4-20250514',
    apiKey: { env: 'ANTHROPIC_API_KEY' },
    maxTokens: 4096,
  },
  // ...
})
class ComplexReasonerAgent extends AgentContext {}
```

## What This Demonstrates

- Setting `provider: 'anthropic'` with a supported model (`claude-sonnet-4-20250514` or `claude-opus-4-20250514`)
- Using `{ env: 'ANTHROPIC_API_KEY' }` to read the API key from an environment variable
- Setting `maxTokens` at the LLM config level and overriding per-call via `this.completion()` options
- Passing `temperature` as a per-call option for controlling response creativity

## Related

- See `create-agent-llm-config` for all supported providers and the common models table
- See `create-agent` for full agent patterns including inner tools and swarm configuration
