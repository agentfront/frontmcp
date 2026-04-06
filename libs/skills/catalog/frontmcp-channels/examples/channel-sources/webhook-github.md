---
name: webhook-github
reference: channel-sources
level: basic
description: Forward GitHub webhook events (PRs, pushes, CI) into Claude Code
tags: [webhook, github, ci, notifications]
features:
  - Webhook source with HTTP POST endpoint
  - GitHub event type routing
  - Static meta for team context
---

# GitHub Webhook Channel

Forward GitHub webhook events (PRs, pushes, CI) into Claude Code

## Code

```typescript
// src/apps/devops/channels/github-webhook.channel.ts
import { Channel, ChannelContext, ChannelNotification } from '@frontmcp/sdk';

interface GitHubWebhookPayload {
  body: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
}

@Channel({
  name: 'github',
  description: 'GitHub repository events (PRs, pushes, CI status)',
  source: { type: 'webhook', path: '/hooks/github' },
  meta: { platform: 'github' },
})
export class GitHubWebhookChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    const { body, headers } = payload as GitHubWebhookPayload;
    const eventType = headers['x-github-event'] as string;

    switch (eventType) {
      case 'push': {
        const push = body as { ref: string; commits: Array<{ message: string; author: { name: string } }> };
        const branch = push.ref.replace('refs/heads/', '');
        const commits = push.commits.map((c) => `  - ${c.author.name}: ${c.message}`).join('\n');
        return {
          content: `Push to ${branch}:\n${commits}`,
          meta: { event: 'push', branch },
        };
      }
      case 'pull_request': {
        const pr = body as {
          action: string;
          pull_request: { title: string; number: number; html_url: string; user: { login: string } };
        };
        return {
          content: `PR #${pr.pull_request.number} ${pr.action} by ${pr.pull_request.user.login}: ${pr.pull_request.title}\n${pr.pull_request.html_url}`,
          meta: { event: 'pull_request', action: pr.action },
        };
      }
      case 'check_run': {
        const check = body as { check_run: { name: string; conclusion: string | null; html_url: string } };
        const conclusion = check.check_run.conclusion ?? 'in_progress';
        return {
          content: `CI check "${check.check_run.name}" ${conclusion}\n${check.check_run.html_url}`,
          meta: { event: 'check_run', conclusion },
        };
      }
      default:
        return {
          content: `GitHub event: ${eventType}`,
          meta: { event: eventType },
        };
    }
  }
}
```

## What This Demonstrates

- Webhook source with HTTP POST endpoint
- GitHub event type routing
- Static meta for team context

## Related

- See `channel-sources` for all source type documentation
