---
name: create-agent
description: Create autonomous AI agents that use LLM reasoning to plan and invoke inner tools
---

# Creating an Autonomous Agent

Agents are autonomous AI entities that use an LLM to reason, plan, and invoke inner tools to accomplish goals. In FrontMCP, agents are TypeScript classes that extend `AgentContext`, decorated with `@Agent`, and registered on a `@FrontMcp` server or inside an `@App`.

## When to Use This Skill

### Must Use

- Building an autonomous AI entity that uses LLM reasoning to decide which tools to call
- Orchestrating multi-step workflows where the agent plans, acts, and iterates toward a goal
- Creating multi-agent swarms with handoff between specialized agents

### Recommended

- Performing complex tasks that require chaining multiple inner tools with LLM-driven decisions
- Implementing structured multi-pass review (security pass, quality pass, synthesis)
- Composing nested sub-agents with different LLM configs for specialized subtasks

### Skip When

- You need a direct, deterministic function that executes a single action (see `create-tool`)
- You are building a reusable conversation template without autonomous execution (see `create-prompt`)
- You only need to expose readable data at a URI (see `create-resource`)

> **Decision:** Use this skill when the task requires autonomous LLM-driven reasoning, tool invocation, and iterative planning -- not a single deterministic action.

### @Agent vs @Tool Quick Comparison

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
    provider: 'anthropic', // Any supported provider — 'anthropic', 'openai', etc.
    model: 'claude-sonnet-4-20250514', // Any supported model for the chosen provider
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
    provider: 'anthropic',          // 'anthropic' or 'openai'
    model: 'claude-sonnet-4-20250514',
    apiKey: { env: 'ANTHROPIC_API_KEY' }, // read from env var
  },
})
```

The `apiKey` field accepts either an object `{ env: 'ENV_VAR_NAME' }` to read from environment variables, or a string value directly (not recommended for production).

```typescript
// OpenAI example
llm: {
  provider: 'openai',
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
    provider: 'anthropic',
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
    provider: 'openai',
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
  llm: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: { env: 'ANTHROPIC_API_KEY' } },
  systemInstructions: 'Focus on OWASP Top 10 vulnerabilities.',
  tools: [StaticAnalysisTool],
})
class SecurityAuditorAgent extends AgentContext {}

@Agent({
  name: 'performance_auditor',
  description: 'Audits code for performance issues',
  llm: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: { env: 'ANTHROPIC_API_KEY' } },
  systemInstructions: 'Focus on time complexity, memory leaks, and N+1 queries.',
  tools: [ProfilerTool],
})
class PerformanceAuditorAgent extends AgentContext {}

@Agent({
  name: 'code_auditor',
  description: 'Comprehensive code auditor that delegates to specialized sub-agents',
  llm: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: { env: 'ANTHROPIC_API_KEY' } },
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
  llm: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: { env: 'ANTHROPIC_API_KEY' } },
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
  llm: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: { env: 'ANTHROPIC_API_KEY' } },
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
    provider: 'anthropic',
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
    provider: 'anthropic',
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
    provider: 'anthropic',
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
    provider: 'anthropic',
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

## Common Patterns

| Pattern                 | Correct                                                                       | Incorrect                                                      | Why                                                                             |
| ----------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| LLM config              | `llm: { provider: 'anthropic', model: '...', apiKey: { env: 'KEY' } }`        | `llm: { provider: 'anthropic', apiKey: 'sk-hardcoded' }`       | Environment variable references prevent leaking secrets in code                 |
| Inner tools vs exported | `tools: [...]` for agent-private; `exports: { tools: [...] }` for MCP-visible | Putting all tools in `tools` and expecting clients to see them | Inner tools are private to the agent; only exported tools appear in MCP listing |
| Custom execute          | Override `execute()` for multi-pass orchestration                             | Putting all logic in system instructions                       | Custom `execute()` gives structured control over completion calls and stages    |
| Sub-agents              | Use `agents: [SubAgent]` for composition                                      | Calling another agent's `execute()` directly                   | The `agents` array enables proper lifecycle, scope isolation, and handoff       |
| Swarm handoff           | Use `swarm.handoff` with `agent` name and `condition`                         | Manually routing between agents in `execute()`                 | Swarm config enables declarative, LLM-driven handoff between agents             |

## Verification Checklist

### Configuration

- [ ] Agent class extends `AgentContext` and has `@Agent` decorator with `name`, `description`, and `llm`
- [ ] `inputSchema` is defined with Zod raw shape for input validation
- [ ] Inner tools in `tools` array are valid `@Tool` classes
- [ ] Agent is registered in `agents` array of `@App` or `@FrontMcp`
- [ ] API key uses `{ env: 'VAR_NAME' }` pattern, not hardcoded strings

### Runtime

- [ ] Agent appears in MCP tool listing (agents surface as callable tools)
- [ ] LLM adapter connects successfully to the configured provider
- [ ] Inner tools are invoked correctly during the agent loop
- [ ] `this.completion()` and `this.streamCompletion()` return valid responses
- [ ] Swarm handoff transfers control to the correct specialist agent

## Troubleshooting

| Problem                             | Cause                                                 | Solution                                                                          |
| ----------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| Agent not appearing in tool listing | Not registered in `agents` array                      | Add agent class to `@App` or `@FrontMcp` `agents` array                           |
| LLM authentication error            | API key not set or incorrect env variable             | Verify the environment variable name in `apiKey: { env: '...' }` is set           |
| Inner tools not being called        | Tools not listed in `tools` array of `@Agent`         | Add tool classes to the `tools` field in the `@Agent` decorator                   |
| Agent times out                     | No timeout or rate limit configured                   | Add `timeout: { executeMs: 120_000 }` and `rateLimit` to `@Agent` options         |
| Swarm handoff fails                 | Target agent name does not match any registered agent | Ensure `handoff.agent` matches the `name` of a registered agent in the same scope |

## Examples

| Example                                                                            | Level        | Description                                                                                       |
| ---------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------- |
| [`basic-agent-with-tools`](../examples/create-agent/basic-agent-with-tools.md)     | Basic        | An autonomous agent that uses inner tools to review GitHub pull requests.                         |
| [`custom-multi-pass-agent`](../examples/create-agent/custom-multi-pass-agent.md)   | Intermediate | An agent that overrides `execute()` to perform multi-pass LLM reasoning with `this.completion()`. |
| [`nested-agents-with-swarm`](../examples/create-agent/nested-agents-with-swarm.md) | Advanced     | Composing specialized sub-agents and configuring swarm-based handoff between agents.              |

> See all examples in [`examples/create-agent/`](../examples/create-agent/)

## Reference

- [Agents Documentation](https://docs.agentfront.dev/frontmcp/servers/agents)
- Related skills: `create-tool`, `create-provider`, `create-prompt`, `create-resource`
