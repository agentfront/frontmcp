---
name: basic-agent-with-tools
reference: create-agent
level: basic
description: 'An autonomous agent that uses inner tools to review GitHub pull requests.'
tags: [development, anthropic, agent, tools]
features:
  - 'Creating an agent with `@Agent` decorator, `llm` config, and `inputSchema`'
  - 'Defining inner tools in the `tools` array that the agent can invoke during its reasoning loop'
  - "Using `{ env: 'ANTHROPIC_API_KEY' }` for safe API key configuration"
  - 'Inner tools are private to the agent and not exposed to external MCP clients'
  - 'The default `execute()` runs the full agent loop without needing an override'
---

# Basic Agent with Inner Tools

An autonomous agent that uses inner tools to review GitHub pull requests.

## Code

```typescript
// src/apps/review/tools/fetch-pr.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'fetch_pr',
  description: 'Fetch pull request details from GitHub',
  inputSchema: {
    owner: z.string(),
    repo: z.string(),
    number: z.number(),
  },
})
class FetchPRTool extends ToolContext {
  async execute(input: { owner: string; repo: string; number: number }) {
    const response = await this.fetch(
      `https://api.github.com/repos/${input.owner}/${input.repo}/pulls/${input.number}`,
    );
    return response.json();
  }
}
```

```typescript
// src/apps/review/tools/post-review.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'post_review_comment',
  description: 'Post a review comment on a PR',
  inputSchema: {
    owner: z.string(),
    repo: z.string(),
    number: z.number(),
    body: z.string(),
  },
})
class PostReviewCommentTool extends ToolContext {
  async execute(input: { owner: string; repo: string; number: number; body: string }) {
    await this.fetch(`https://api.github.com/repos/${input.owner}/${input.repo}/pulls/${input.number}/reviews`, {
      method: 'POST',
      body: JSON.stringify({ body: input.body, event: 'COMMENT' }),
    });
    return 'Comment posted';
  }
}
```

```typescript
// src/apps/review/agents/pr-reviewer.agent.ts
import { Agent, AgentContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Agent({
  name: 'pr_reviewer',
  description: 'Autonomously reviews GitHub pull requests',
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    apiKey: { env: 'ANTHROPIC_API_KEY' },
  },
  inputSchema: {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    prNumber: z.number().describe('PR number to review'),
  },
  systemInstructions: 'You are a senior code reviewer. Fetch the PR, analyze changes, and post a thorough review.',
  tools: [FetchPRTool, PostReviewCommentTool],
})
class PRReviewerAgent extends AgentContext {
  // Default execute() runs the agent loop.
  // The agent will autonomously call FetchPRTool, analyze the diff,
  // and call PostReviewCommentTool to leave a review.
}
```

```typescript
// src/apps/review/index.ts
import { App } from '@frontmcp/sdk';

@App({
  name: 'review-app',
  agents: [PRReviewerAgent],
})
class ReviewApp {}
```

## What This Demonstrates

- Creating an agent with `@Agent` decorator, `llm` config, and `inputSchema`
- Defining inner tools in the `tools` array that the agent can invoke during its reasoning loop
- Using `{ env: 'ANTHROPIC_API_KEY' }` for safe API key configuration
- Inner tools are private to the agent and not exposed to external MCP clients
- The default `execute()` runs the full agent loop without needing an override

## Related

- See `create-agent` for custom execute, sub-agents, swarm configuration, and exported tools
- See `create-agent-llm-config` for all supported LLM providers and model options
