---
name: openai-config
reference: create-agent-llm-config
level: basic
description: 'Configuring an agent with the OpenAI provider and different model options.'
tags: [development, openai, llm, agent, config]
features:
  - "Setting `provider: 'openai'` with `gpt-4o` for general purpose or `gpt-4o-mini` for cost-effective tasks"
  - "The API key pattern `{ env: 'OPENAI_API_KEY' }` works the same across all providers"
  - 'Combining LLM config with inner tools -- the agent uses OpenAI to reason about tool invocations'
  - 'Choosing the right model for the task: `gpt-4o` for complex workflows, `gpt-4o-mini` for fast classification'
---

# OpenAI LLM Configuration

Configuring an agent with the OpenAI provider and different model options.

## Code

```typescript
// src/apps/main/agents/data-pipeline.agent.ts
import { Agent, AgentContext, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'extract_data',
  description: 'Extract data from a source',
  inputSchema: { source: z.string() },
})
class ExtractTool extends ToolContext {
  async execute(input: { source: string }) {
    return { data: `extracted from ${input.source}` };
  }
}

@Agent({
  name: 'data_pipeline',
  description: 'Data processing pipeline agent',
  llm: {
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: { env: 'OPENAI_API_KEY' },
    maxTokens: 4096,
  },
  inputSchema: {
    source: z.string().describe('Data source to process'),
  },
  tools: [ExtractTool],
  systemInstructions: 'You are a data processing agent. Extract and transform data from the given source.',
})
class DataPipelineAgent extends AgentContext {}
```

```typescript
// For a cost-effective model:
@Agent({
  name: 'quick_classifier',
  description: 'Fast classification of incoming requests',
  llm: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: { env: 'OPENAI_API_KEY' },
    maxTokens: 1024,
  },
  // ...
})
class QuickClassifierAgent extends AgentContext {}
```

## What This Demonstrates

- Setting `provider: 'openai'` with `gpt-4o` for general purpose or `gpt-4o-mini` for cost-effective tasks
- The API key pattern `{ env: 'OPENAI_API_KEY' }` works the same across all providers
- Combining LLM config with inner tools -- the agent uses OpenAI to reason about tool invocations
- Choosing the right model for the task: `gpt-4o` for complex workflows, `gpt-4o-mini` for fast classification

## Related

- See `create-agent-llm-config` for the complete common models table and API key source options
- See `create-agent` for sub-agents using different providers for specialized tasks
