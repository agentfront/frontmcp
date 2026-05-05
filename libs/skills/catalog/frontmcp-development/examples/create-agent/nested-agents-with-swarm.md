---
name: nested-agents-with-swarm
reference: create-agent
level: advanced
description: 'Composing specialized agents with swarm visibility so an orchestrator can call peers as use-agent:* tools.'
tags: [development, agent, nested, agents, swarm]
features:
  - 'Setting `swarm: { canSeeOtherAgents: true, visibleAgents: [...] }` on the orchestrator'
  - 'Setting `swarm: { isVisible: true }` (the default) on specialist peers'
  - 'Routing is driven by the orchestrator LLM choosing among `use-agent:<peer>` tools, not by declarative handoff rules'
  - 'Each agent has its own `llm` config, `tools`, and `systemInstructions` for specialization'
---

# Multi-Agent Swarm Visibility

Composing specialized agents into a swarm where an orchestrator can discover and call peers at runtime as `use-agent:<name>` tools. Routing is driven by the orchestrator's LLM, not a declarative handoff table.

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
// src/apps/support/agents/triage.agent.ts
import { Agent, AgentContext, z } from '@frontmcp/sdk';

@Agent({
  id: 'triage_agent',
  name: 'triage_agent',
  description: 'Triages incoming requests and delegates to specialists',
  llm: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: { env: 'ANTHROPIC_API_KEY' } },
  inputSchema: {
    request: z.string().describe('The incoming user request'),
  },
  // Orchestrator: opts in to seeing peers and (optionally) restricts to a whitelist.
  swarm: {
    canSeeOtherAgents: true,
    visibleAgents: ['billing_agent', 'technical_agent'],
    maxCallDepth: 3,
  },
  systemInstructions:
    'Analyze the request and delegate by calling either use-agent:billing_agent (for billing/payments) or use-agent:technical_agent (for technical issues).',
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

- Setting `swarm: { canSeeOtherAgents: true, visibleAgents: [...] }` on the orchestrator so peers appear as `use-agent:*` tools
- Setting `swarm: { isVisible: true }` (the default) on specialist peers so they can be called
- Routing is driven by the orchestrator LLM choosing among `use-agent:<peer>` tools, not by a declarative handoff table
- Each agent has its own `llm` config, `tools`, and `systemInstructions` for specialization

## Related

- See `create-agent` for the full swarm field reference and inner-tool composition
- See `create-agent-llm-config` for using different LLM providers per agent
