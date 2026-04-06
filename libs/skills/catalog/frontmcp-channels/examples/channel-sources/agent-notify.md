---
name: agent-notify
reference: channel-sources
level: intermediate
description: Notify Claude Code when AI agents complete their tasks
tags: [agents, completion, notifications, automation]
features:
  - Agent completion source with ID filtering
  - Duration and output reporting
  - Integration with agent registry emitter
---

# Agent Completion Channel

Notify Claude Code when AI agents complete their tasks

## Code

```typescript
// src/apps/automation/channels/agent-done.channel.ts
import { Channel, ChannelContext, ChannelNotification } from '@frontmcp/sdk';

@Channel({
  name: 'agent-done',
  description: 'Notifies when code review or test agents complete',
  source: {
    type: 'agent-completion',
    agentIds: ['code-reviewer', 'test-writer', 'security-scanner'],
  },
})
export class AgentDoneChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const event = payload as {
      agentId: string;
      agentName: string;
      status: 'success' | 'error';
      durationMs?: number;
      output?: string;
      error?: string;
    };

    const duration = event.durationMs ? ` in ${(event.durationMs / 1000).toFixed(1)}s` : '';

    if (event.status === 'error') {
      return {
        content: `Agent "${event.agentName}" failed${duration}.\nError: ${event.error ?? 'Unknown error'}`,
        meta: { agent: event.agentId, status: 'error' },
      };
    }

    const output = event.output ? `\nResult: ${event.output.slice(0, 500)}` : '';

    return {
      content: `Agent "${event.agentName}" completed successfully${duration}.${output}`,
      meta: { agent: event.agentId, status: 'success' },
    };
  }
}
```

## What This Demonstrates

- Agent completion source with ID filtering
- Duration and output reporting
- Integration with agent registry emitter

## Related

- See `channel-sources` for all source type documentation
- See `frontmcp-development` for agent creation patterns
