---
name: nested-agents-with-swarm
reference: create-agent
level: advanced
description: Composing specialized agents into a swarm where an orchestrator can discover and call peers at runtime as `invoke_<id>` tools, plus a nested sub-agent and `this.invokeAgent()`. Routing is driven by the orchestrator's LLM, not a declarative handoff table.
tags:
  - development
  - agent
  - nested
  - agents
  - swarm
features:
  - 'Setting `swarm: { canSeeOtherAgents: true, visibleAgents: [...] }` on the orchestrator so peers are offered to its model as `invoke_*` tools'
  - 'Setting `swarm: { isVisible: true }` (the default) on specialist peers so they can be called'
  - Routing is driven by the orchestrator LLM choosing among `invoke_<peer>` tools, not by a declarative handoff table
  - 'A nested sub-agent (`agents: [...]`) private to the orchestrator, called from code with `this.invokeAgent()`'
  - '`swarm.maxCallDepth` bounding how deep agents may call each other'
  - Each agent has its own `llm` config, `tools`, and `systemInstructions` for specialization
---

# Multi-Agent Swarm Visibility

Composing specialized agents into a swarm where an orchestrator can discover and call peers at runtime as `invoke_<id>` tools, plus a nested sub-agent and `this.invokeAgent()`. Routing is driven by the orchestrator's LLM, not a declarative handoff table.

## Code

```typescript
// src/apps/support/agents/billing.agent.ts
import { Agent, AgentContext, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'lookup_invoice',
  description: 'Look up an invoice by ID',
  inputSchema: { invoiceId: z.string() },
})
class LookupInvoiceTool extends ToolContext {
  async execute(input: { invoiceId: string }) {
    return { id: input.invoiceId, amount: 99.99, status: 'paid' };
  }
}

@Agent({
  id: 'billing_agent',
  name: 'billing_agent',
  description: 'Handles billing and payment inquiries',
  llm: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: { env: 'ANTHROPIC_API_KEY' } },
  tools: [LookupInvoiceTool],
  // isVisible defaults to true; specialists do not need swarm config to be callable.
  swarm: { isVisible: true },
})
class BillingAgent extends AgentContext {}
```

```typescript
// src/apps/support/agents/technical.agent.ts
import { Agent, AgentContext } from '@frontmcp/sdk';

@Agent({
  id: 'technical_agent',
  name: 'technical_agent',
  description: 'Handles technical support issues',
  llm: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: { env: 'ANTHROPIC_API_KEY' } },
  systemInstructions: 'You are a technical support specialist. Diagnose issues and provide solutions.',
  swarm: { isVisible: true },
})
class TechnicalAgent extends AgentContext {}
```

```typescript
// src/apps/support/agents/sentiment.agent.ts
import { Agent, AgentContext, z } from '@frontmcp/sdk';

// Nested in the triage agent below: private to it, never offered to clients.
@Agent({
  id: 'sentiment_agent',
  name: 'sentiment_agent',
  description: 'Rates how upset a customer is',
  llm: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: { env: 'ANTHROPIC_API_KEY' } },
  inputSchema: { request: z.string() },
  outputSchema: { urgency: z.enum(['low', 'high']) },
})
export class SentimentAgent extends AgentContext {}
```

```typescript
// src/apps/support/agents/triage.agent.ts
import { Agent, AgentContext, z } from '@frontmcp/sdk';

import { SentimentAgent } from './sentiment.agent';

@Agent({
  id: 'triage_agent',
  name: 'triage_agent',
  description: 'Triages incoming requests and delegates to specialists',
  llm: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: { env: 'ANTHROPIC_API_KEY' } },
  inputSchema: {
    request: z.string().describe('The incoming user request'),
  },
  // Nested sub-agent: offered to this agent's model as invoke_sentiment_agent, and callable from code.
  agents: [SentimentAgent],
  // Orchestrator: opts in to seeing peers and (optionally) restricts to a whitelist.
  swarm: {
    canSeeOtherAgents: true,
    visibleAgents: ['billing_agent', 'technical_agent'],
    maxCallDepth: 3, // a deeper agent-to-agent chain fails with AGENT_CALL_DEPTH_EXCEEDED
  },
  systemInstructions:
    'Analyze the request and delegate by calling either invoke_billing_agent (for billing/payments) or invoke_technical_agent (for technical issues).',
})
class TriageAgent extends AgentContext {
  async execute(input: { request: string }) {
    // Code can call a nested agent, or a peer it sees, and gets its output back.
    const sentiment = (await this.invokeAgent('sentiment_agent', { request: input.request })) as { urgency: string };
    if (sentiment.urgency === 'high') {
      return this.invokeAgent('technical_agent', { request: input.request });
    }
    // Otherwise let the model route among invoke_billing_agent / invoke_technical_agent.
    return super.execute(input);
  }
}
```

```typescript
// src/apps/support/index.ts
import { App } from '@frontmcp/sdk';

@App({
  name: 'support-app',
  agents: [TriageAgent, BillingAgent, TechnicalAgent],
})
class SupportApp {}
```

## What This Demonstrates

- Setting `swarm: { canSeeOtherAgents: true, visibleAgents: [...] }` on the orchestrator so peers are offered to its model as `invoke_*` tools
- Setting `swarm: { isVisible: true }` (the default) on specialist peers so they can be called
- Routing is driven by the orchestrator LLM choosing among `invoke_<peer>` tools, not by a declarative handoff table
- A nested sub-agent (`agents: [...]`) private to the orchestrator, called from code with `this.invokeAgent()`
- `swarm.maxCallDepth` bounding how deep agents may call each other
- Each agent has its own `llm` config, `tools`, and `systemInstructions` for specialization

## Related

- See `create-agent` for the full swarm field reference and inner-tool composition
- See `create-agent-llm-config` for using different LLM providers per agent
