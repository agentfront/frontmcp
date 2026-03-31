---
name: nested-agents-with-swarm
reference: create-agent
level: advanced
description: 'Composing specialized sub-agents and configuring swarm-based handoff between agents.'
tags: [development, agent, nested, agents, swarm]
features:
  - "Configuring `swarm` with `role: 'coordinator'` for the triage agent and `role: 'specialist'` for domain agents"
  - 'Defining `handoff` rules with `agent` name and `condition` for declarative LLM-driven routing'
  - 'Specialist agents can hand back to the triage agent when a request falls outside their scope'
  - 'Each agent has its own `llm` config, `tools`, and `systemInstructions` for specialization'
---

# Nested Sub-Agents and Swarm Handoff

Composing specialized sub-agents and configuring swarm-based handoff between agents.

## Code

```typescript
// src/apps/support/agents/billing.agent.ts
import { Agent, AgentContext, Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

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
  name: 'billing_agent',
  description: 'Handles billing and payment inquiries',
  llm: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: { env: 'ANTHROPIC_API_KEY' } },
  tools: [LookupInvoiceTool],
  swarm: {
    role: 'specialist',
    handoff: [{ agent: 'triage_agent', condition: 'Request is outside billing scope' }],
  },
})
class BillingAgent extends AgentContext {}
```

```typescript
// src/apps/support/agents/technical.agent.ts
import { Agent, AgentContext } from '@frontmcp/sdk';

@Agent({
  name: 'technical_agent',
  description: 'Handles technical support issues',
  llm: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: { env: 'ANTHROPIC_API_KEY' } },
  systemInstructions: 'You are a technical support specialist. Diagnose issues and provide solutions.',
  swarm: {
    role: 'specialist',
    handoff: [{ agent: 'triage_agent', condition: 'Request is outside technical scope' }],
  },
})
class TechnicalAgent extends AgentContext {}
```

```typescript
// src/apps/support/agents/triage.agent.ts
import { Agent, AgentContext } from '@frontmcp/sdk';
import { z } from 'zod';

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
    ],
  },
  systemInstructions: 'Analyze the request and hand off to the appropriate specialist agent.',
})
class TriageAgent extends AgentContext {}
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

- Configuring `swarm` with `role: 'coordinator'` for the triage agent and `role: 'specialist'` for domain agents
- Defining `handoff` rules with `agent` name and `condition` for declarative LLM-driven routing
- Specialist agents can hand back to the triage agent when a request falls outside their scope
- Each agent has its own `llm` config, `tools`, and `systemInstructions` for specialization

## Related

- See `create-agent` for exported tools, function-style builder, providers, and rate limiting
- See `create-agent-llm-config` for using different LLM providers per agent
