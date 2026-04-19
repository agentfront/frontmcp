---
name: custom-multi-pass-agent
reference: create-agent
level: intermediate
description: 'An agent that overrides `execute()` to perform multi-pass LLM reasoning with `this.completion()`.'
tags: [development, security, agent, custom, multi, pass]
features:
  - 'Overriding `execute()` for custom multi-pass orchestration instead of the default agent loop'
  - 'Using `this.completion()` to make individual LLM calls with full control over prompts'
  - 'Using `this.mark(stage)` to track execution stages (security-pass, quality-pass, synthesis)'
  - 'Defining `outputSchema` with Zod to validate and type-check the structured return value'
---

# Custom Multi-Pass Agent with Structured Output

An agent that overrides `execute()` to perform multi-pass LLM reasoning with `this.completion()`.

## Code

```typescript
// src/apps/review/agents/structured-reviewer.agent.ts
import { Agent, AgentContext, z } from '@frontmcp/sdk';

@Agent({
  name: 'structured_reviewer',
  description: 'Reviews code with a structured multi-pass approach',
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    apiKey: { env: 'ANTHROPIC_API_KEY' },
  },
  inputSchema: {
    code: z.string().describe('Source code to review'),
  },
  outputSchema: {
    issues: z.array(
      z.object({
        severity: z.enum(['error', 'warning', 'info']),
        line: z.number(),
        message: z.string(),
      }),
    ),
    summary: z.string(),
  },
})
class StructuredReviewerAgent extends AgentContext {
  async execute(input: { code: string }) {
    this.mark('security-pass');
    const securityReview = await this.completion({
      messages: [{ role: 'user', content: `Review this code for security issues:\n${input.code}` }],
    });

    this.mark('quality-pass');
    const qualityReview = await this.completion({
      messages: [{ role: 'user', content: `Review this code for quality issues:\n${input.code}` }],
    });

    this.mark('synthesis');
    const finalReview = await this.completion({
      messages: [
        {
          role: 'user',
          content: `Combine these reviews into a structured JSON report with "issues" (array of {severity, line, message}) and "summary" (string):\nSecurity: ${securityReview.content}\nQuality: ${qualityReview.content}`,
        },
      ],
    });

    return JSON.parse(finalReview.content);
  }
}
```

```typescript
// src/apps/review/index.ts
import { App } from '@frontmcp/sdk';

@App({
  name: 'review-app',
  agents: [StructuredReviewerAgent],
})
class ReviewApp {}
```

## What This Demonstrates

- Overriding `execute()` for custom multi-pass orchestration instead of the default agent loop
- Using `this.completion()` to make individual LLM calls with full control over prompts
- Using `this.mark(stage)` to track execution stages (security-pass, quality-pass, synthesis)
- Defining `outputSchema` with Zod to validate and type-check the structured return value

## Related

- See `create-agent` for streaming with `streamCompletion()`, sub-agents, and swarm handoff
- See `create-agent-llm-config` for provider-specific options like `maxTokens` and `temperature`
