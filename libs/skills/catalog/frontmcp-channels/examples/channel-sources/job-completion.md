---
name: job-completion
reference: channel-sources
level: intermediate
description: Notify Claude Code when background jobs and workflows complete
tags: [jobs, workflows, completion, background, notifications]
features:
  - Job completion source with name filtering
  - Status-aware notification formatting
  - Duration and output reporting
---

# Job Completion Channel

Notify Claude Code when background jobs and workflows complete

## Code

```typescript
// src/apps/automation/channels/job-done.channel.ts
import { Channel, ChannelContext } from '@frontmcp/sdk';
import type { ChannelNotification } from '@frontmcp/sdk';

@Channel({
  name: 'job-alerts',
  description: 'Background job and workflow completion alerts',
  source: {
    type: 'job-completion',
    jobNames: ['daily-report', 'data-sync', 'backup'],
  },
})
export class JobAlertsChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const event = payload as {
      jobName: string;
      jobId: string;
      status: 'success' | 'error' | 'timeout' | 'cancelled';
      durationMs?: number;
      output?: string;
      error?: string;
      attempt?: number;
    };

    const duration = event.durationMs ? ` (${(event.durationMs / 1000).toFixed(1)}s)` : '';
    const attempt = event.attempt && event.attempt > 1 ? ` [attempt ${event.attempt}]` : '';

    if (event.status === 'error') {
      return {
        content: `Job "${event.jobName}" FAILED${duration}${attempt}\nError: ${event.error ?? 'Unknown'}`,
        meta: { job: event.jobName, status: 'error', severity: 'high' },
      };
    }

    if (event.status === 'timeout') {
      return {
        content: `Job "${event.jobName}" TIMED OUT${duration}${attempt}`,
        meta: { job: event.jobName, status: 'timeout', severity: 'high' },
      };
    }

    const output = event.output ? `\nResult: ${event.output.slice(0, 300)}` : '';
    return {
      content: `Job "${event.jobName}" completed${duration}${attempt}${output}`,
      meta: { job: event.jobName, status: event.status },
    };
  }
}
```

## What This Demonstrates

- Job completion source with name filtering
- Status-aware notification formatting
- Duration and output reporting

## Related

- See `channel-sources` for all source type documentation
- See `frontmcp-development` for job creation patterns
