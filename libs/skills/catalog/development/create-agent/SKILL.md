---
name: create-agent
description: Create autonomous AI agents with inner tools, LLM providers, and multi-agent swarms. Use when building agents, configuring LLM adapters, adding inner tools, or setting up agent handoff.
tags: [agent, ai, llm, tools, autonomous]
parameters:
  - name: llm-provider
    description: LLM provider to use
    type: string
    default: anthropic
  - name: name
    description: Agent name
    type: string
    required: true
examples:
  - scenario: Create a code review agent with GitHub tools
    expected-outcome: Agent autonomously reviews PRs using inner tools
  - scenario: Create a multi-agent swarm for complex workflows
    expected-outcome: Agents hand off tasks to each other
priority: 8
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/servers/agents
---

# Creating an Autonomous Agent

Agents are autonomous AI entities that use an LLM to reason, plan, and invoke inner tools to accomplish goals. In FrontMCP, agents are TypeScript classes that extend `AgentContext`, decorated with `@Agent`, and registered on a `@FrontMcp` server or inside an `@App`.

## When to Use @Agent vs @Tool

Use `@Agent` when the task requires autonomous reasoning, multi-step planning, or LLM-driven decision making. An agent receives a goal, decides which tools to call, interprets results, and iterates until the goal is met. Use `@Tool` when you need a direct, deterministic function that executes a single action without LLM involvement.

| Aspect          | @Agent                          | @Tool                        |
| --------------- | ------------------------------- | ---------------------------- |
| Execution       | Autonomous LLM loop             | Direct function call         |
| Decision making | LLM chooses what to do          | Caller decides               |
| Inner tools     | Has its own tools it can invoke | No inner tools               |
| Use case        | Complex, multi-step workflows   | Single, well-defined actions |

## Class-Based Pattern

Create a class extending `AgentContext<In, Out>` and optionally override the `execute(input: In): Promise<Out>` method. The `@Agent` decorator requires `name`, `description`, and `llm` configuration.

```typescript
import { Agent, AgentContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Agent({
  name: 'code_reviewer',
  description: 'Reviews code changes and provides feedback',
  llm: {
    adapter: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    apiKey: { env: 'ANTHROPIC_API_KEY' },
  },
  inputSchema: {
    diff: z.string().describe('The code diff to review'),
    language: z.string().optional().describe('Programming language'),
  },
  systemInstructions: 'You are an expert code reviewer. Focus on correctness, performance, and maintainability.',
})
class CodeReviewerAgent extends AgentContext {
  async execute(input: { diff: string; language?: string }) {
    // Default behavior: runs the agent loop automatically
    // The agent will use its LLM to analyze the diff and produce a review
    return super.execute(input);
  }
}
```

### Available Context Methods and Properties

`AgentContext` extends `ExecutionContextBase`, which provides:

**Agent-Specific Methods:**

- `execute(input: In): Promise<Out>` -- the main method; default runs the agent loop
- `completion(prompt: AgentPrompt, options?): Promise<AgentCompletion>` -- make a single LLM call
- `streamCompletion(prompt: AgentPrompt, options?): AsyncIterable<AgentCompletionChunk>` -- stream an LLM response
- `executeTool(toolDef, input): Promise<unknown>` -- (protected) invoke one of the agent's inner tools programmatically

**Inherited Methods:**

- `this.get(token)` -- resolve a dependency from DI (throws if not found)
- `this.tryGet(token)` -- resolve a dependency from DI (returns `undefined` if not found)
- `this.fail(err)` -- abort execution, triggers error flow (never returns)
- `this.mark(stage)` -- set the active execution stage for debugging/tracking
- `this.fetch(input, init?)` -- HTTP fetch with context propagation
- `this.notify(message, level?)` -- send a log-level notification to the client
- `this.respondProgress(value, total?)` -- send a progress notification to the client

**Properties:**

- `this.input` -- the validated input object
- `this.output` -- the output (available after execute)
- `this.llmAdapter` -- the configured LLM adapter instance
- `this.toolDefinitions` -- definitions of inner tools available to the agent
- `this.toolExecutor` -- executor for invoking inner tools
- `this.metadata` -- agent metadata from the decorator
- `this.scope` -- the current scope instance
- `this.context` -- the execution context

## LLM Configuration

The `llm` field is required and configures which LLM provider and model the agent uses.

```typescript
@Agent({
  name: 'my_agent',
  description: 'An agent with LLM config',
  llm: {
    adapter: 'anthropic',          // 'anthropic' or 'openai'
    model: 'claude-sonnet-4-20250514',
    apiKey: { env: 'ANTHROPIC_API_KEY' }, // read from env var
  },
})
```

The `apiKey` field accepts either an object `{ env: 'ENV_VAR_NAME' }` to read from environment variables, or a string value directly (not recommended for production).

```typescript
// OpenAI example
llm: {
  adapter: 'openai',
  model: 'gpt-4o',
  apiKey: { env: 'OPENAI_API_KEY' },
},
```

## Custom execute() vs Default Agent Loop

By default, calling `execute()` runs the full agent loop: the LLM receives the input plus system instructions, decides which inner tools to call, processes results, and iterates until it produces a final answer.

Override `execute()` when you need custom orchestration logic:

```typescript
@Agent({
  name: 'structured_reviewer',
  description: 'Reviews code with a structured multi-pass approach',
  llm: {
    adapter: 'anthropic',
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
          content: `Combine these reviews into a structured report:\nSecurity: ${securityReview.content}\nQuality: ${qualityReview.content}`,
        },
      ],
    });

    return JSON.parse(finalReview.content);
  }
}
```

## completion() and streamCompletion()

Use `completion()` for a single LLM call that returns the full response, and `streamCompletion()` for streaming responses token by token.

```typescript
@Agent({
  name: 'summarizer',
  description: 'Summarizes text using LLM',
  llm: {
    adapter: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    apiKey: { env: 'ANTHROPIC_API_KEY' },
  },
  inputSchema: {
    text: z.string().describe('Text to summarize'),
  },
})
class SummarizerAgent extends AgentContext {
  async execute(input: { text: string }) {
    // Single completion call
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

Streaming example:

```typescript
async execute(input: { text: string }) {
  const stream = this.streamCompletion({
    messages: [{ role: 'user', content: `Analyze this text:\n${input.text}` }],
  });

  let fullResponse = '';
  for await (const chunk of stream) {
    fullResponse += chunk.delta;
    await this.notify(`Processing: ${fullResponse.length} chars`, 'debug');
  }

  return fullResponse;
}
```

## Inner Tools

The `tools` array in `@Agent` metadata defines tools that the agent itself can invoke during its reasoning loop. These are NOT exposed to external callers -- they are private to the agent.

```typescript
import { Tool, ToolContext, Agent, AgentContext } from '@frontmcp/sdk';
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

@Agent({
  name: 'pr_reviewer',
  description: 'Autonomously reviews GitHub pull requests',
  llm: {
    adapter: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    apiKey: { env: 'ANTHROPIC_API_KEY' },
  },
  inputSchema: {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    prNumber: z.number().describe('PR number to review'),
  },
  systemInstructions: 'You are a senior code reviewer. Fetch the PR, analyze changes, and post a thorough review.',
  tools: [FetchPRTool, PostReviewCommentTool], // Inner tools the agent can use
})
class PRReviewerAgent extends AgentContext {
  // Default execute() runs the agent loop.
  // The agent will autonomously call FetchPRTool, analyze the diff,
  // and call PostReviewCommentTool to leave a review.
}
```

## Exported Tools

Use `exports: { tools: [] }` to expose specific tools that the agent makes available to external callers. Unlike inner tools (which the agent uses privately), exported tools appear in the MCP tool listing for clients to invoke directly.

```typescript
@Agent({
  name: 'data_pipeline',
  description: 'Data processing pipeline agent',
  llm: {
    adapter: 'openai',
    model: 'gpt-4o',
    apiKey: { env: 'OPENAI_API_KEY' },
  },
  tools: [ExtractTool, TransformTool, LoadTool], // Agent uses these internally
  exports: { tools: [ValidateDataTool, StatusTool] }, // These are exposed to MCP clients
})
class DataPipelineAgent extends AgentContext {}
```

## Nested Agents (Sub-Agents)

Use the `agents` array to compose agents from smaller, specialized sub-agents. Each sub-agent has its own LLM config, inner tools, and system instructions.

```typescript
@Agent({
  name: 'security_auditor',
  description: 'Audits code for security vulnerabilities',
  llm: { adapter: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: { env: 'ANTHROPIC_API_KEY' } },
  systemInstructions: 'Focus on OWASP Top 10 vulnerabilities.',
  tools: [StaticAnalysisTool],
})
class SecurityAuditorAgent extends AgentContext {}

@Agent({
  name: 'performance_auditor',
  description: 'Audits code for performance issues',
  llm: { adapter: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: { env: 'ANTHROPIC_API_KEY' } },
  systemInstructions: 'Focus on time complexity, memory leaks, and N+1 queries.',
  tools: [ProfilerTool],
})
class PerformanceAuditorAgent extends AgentContext {}

@Agent({
  name: 'code_auditor',
  description: 'Comprehensive code auditor that delegates to specialized sub-agents',
  llm: { adapter: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: { env: 'ANTHROPIC_API_KEY' } },
  inputSchema: {
    repository: z.string().describe('Repository URL'),
    branch: z.string().default('main').describe('Branch to audit'),
  },
  agents: [SecurityAuditorAgent, PerformanceAuditorAgent], // Sub-agents
  tools: [CloneRepoTool, GenerateReportTool],
  systemInstructions:
    'Clone the repo, delegate security and performance audits to sub-agents, then compile a final report.',
})
class CodeAuditorAgent extends AgentContext {}
```

## Swarm Configuration

Swarm mode enables multi-agent handoff, where agents can transfer control to each other during execution. Configure swarms using the `swarm` field.

```typescript
@Agent({
  name: 'triage_agent',
  description: 'Triages incoming requests and hands off to specialists',
  llm: { adapter: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: { env: 'ANTHROPIC_API_KEY' } },
  inputSchema: {
    request: z.string().describe('The incoming user request'),
  },
  swarm: {
    role: 'coordinator',
    handoff: [
      { agent: 'billing_agent', condition: 'Request is about billing or payments' },
      { agent: 'technical_agent', condition: 'Request is about technical issues' },
      { agent: 'general_agent', condition: 'Request does not match other categories' },
    ],
  },
  systemInstructions: 'Analyze the request and hand off to the appropriate specialist agent.',
})
class TriageAgent extends AgentContext {}

@Agent({
  name: 'billing_agent',
  description: 'Handles billing and payment inquiries',
  llm: { adapter: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: { env: 'ANTHROPIC_API_KEY' } },
  tools: [LookupInvoiceTool, ProcessRefundTool],
  swarm: {
    role: 'specialist',
    handoff: [{ agent: 'triage_agent', condition: 'Request is outside billing scope' }],
  },
})
class BillingAgent extends AgentContext {}
```

## Function-Style Builder

For agents that do not need a class, use the `agent()` function builder.

```typescript
import { agent } from '@frontmcp/sdk';
import { z } from 'zod';

const QuickSummarizer = agent({
  name: 'quick_summarizer',
  description: 'Summarizes text quickly',
  llm: {
    adapter: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    apiKey: { env: 'ANTHROPIC_API_KEY' },
  },
  inputSchema: {
    text: z.string().describe('Text to summarize'),
    maxLength: z.number().default(100).describe('Max summary length'),
  },
})((input, ctx) => {
  // Custom logic using ctx for completion calls
  return ctx.completion({
    messages: [{ role: 'user', content: `Summarize in ${input.maxLength} chars:\n${input.text}` }],
  });
});
```

Register it the same way as a class agent: `agents: [QuickSummarizer]`.

## Remote and ESM Loading

Load agents from external modules or remote URLs without importing them directly.

**ESM loading** -- load an agent from an ES module:

```typescript
const ExternalAgent = Agent.esm('@my-org/agents@^1.0.0', 'ExternalAgent', {
  description: 'An agent loaded from an ES module',
});
```

**Remote loading** -- load an agent from a remote URL:

```typescript
const CloudAgent = Agent.remote('https://example.com/agents/cloud-agent', 'CloudAgent', {
  description: 'An agent loaded from a remote server',
});
```

Both return values that can be registered in `agents: [ExternalAgent, CloudAgent]`.

## Registration

Add agent classes (or function-style agents) to the `agents` array in `@FrontMcp` or `@App`.

```typescript
import { FrontMcp, App } from '@frontmcp/sdk';

@App({
  name: 'review-app',
  agents: [PRReviewerAgent, CodeAuditorAgent],
  tools: [HelperTool],
})
class ReviewApp {}

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [ReviewApp],
  agents: [QuickSummarizer], // can also register agents directly on the server
})
class MyServer {}
```

## Nx Generator

Scaffold a new agent using the Nx generator:

```bash
nx generate @frontmcp/nx:agent
```

This creates the agent file, spec file, and updates barrel exports.

## Rate Limiting, Concurrency, and Timeout

Protect agents with throttling controls:

```typescript
@Agent({
  name: 'expensive_agent',
  description: 'An agent that performs expensive LLM operations',
  llm: {
    adapter: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    apiKey: { env: 'ANTHROPIC_API_KEY' },
  },
  inputSchema: {
    task: z.string(),
  },
  rateLimit: { maxRequests: 5, windowMs: 60_000 },
  concurrency: { maxConcurrent: 1 },
  timeout: { executeMs: 120_000 },
  tags: ['expensive', 'llm'],
})
class ExpensiveAgent extends AgentContext {
  async execute(input: { task: string }) {
    // At most 5 calls per minute, 1 concurrent, 2 minute timeout
    return super.execute(input);
  }
}
```

## Agent with Providers and Plugins

Agents can include their own providers and plugins for self-contained dependency management:

```typescript
@Agent({
  name: 'database_agent',
  description: 'Agent that interacts with databases',
  llm: {
    adapter: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    apiKey: { env: 'ANTHROPIC_API_KEY' },
  },
  inputSchema: {
    query: z.string().describe('Natural language database query'),
  },
  tools: [RunSqlTool, ListTablesTool, DescribeTableTool],
  providers: [DatabaseProvider],
  plugins: [RememberPlugin],
  systemInstructions:
    'You have access to a database. List tables, describe schemas, and run SQL to answer the user query.',
})
class DatabaseAgent extends AgentContext {}
```

## Agent with Resources and Prompts

Agents can include resources and prompts that are available within the agent's scope:

```typescript
@Agent({
  name: 'docs_agent',
  description: 'Agent that manages documentation',
  llm: {
    adapter: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    apiKey: { env: 'ANTHROPIC_API_KEY' },
  },
  inputSchema: {
    topic: z.string().describe('Topic to document'),
  },
  tools: [WriteFileTool, ReadFileTool],
  resources: [DocsTemplateResource],
  prompts: [TechnicalWritingPrompt],
})
class DocsAgent extends AgentContext {}
```
