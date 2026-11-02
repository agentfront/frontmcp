---
name: persistent-questions-inbox
reference: configure-elicitation
level: advanced
description: 'Keep a question for its caller past the session, answered in the inbox or the CLI.'
tags: [config, elicitation, persistent, inbox, people-auth]
features:
  - 'Turning on `elicitation.persistent` next to `http.auth.people` for the inbox routes'
  - 'Asking with `this.elicit(..., { ttl, persist: { key } })` so the question outlives the call'
  - 'Handing the person a sign-in link bound to the caller with `questionInboxLink(this)`'
  - 'Answering with `frontmcp inbox <link>`, and the next call receiving the answer once'
---

# Persistent Questions with an Inbox

Keep a question for its caller past the session, answered in the inbox or the CLI.

## Code

```typescript
// src/server.ts
import { App, FrontMcp, questionInboxLink, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'approve_deploy',
  description: 'Ask the person to approve a deploy; the question waits for them',
  inputSchema: { version: z.string() },
})
class ApproveDeployTool extends ToolContext {
  async execute(input: { version: string }) {
    const answer = await this.elicit(`Deploy ${input.version} to production?`, z.object({ approve: z.boolean() }), {
      ttl: 60_000,
      persist: { key: `deploy-${input.version}`, ttlMs: 86_400_000 },
    });
    const approved = answer.status === 'accept' && answer.content?.approve === true;
    return { approved };
  }
}

@Tool({ name: 'inbox_link', description: 'A sign-in link to my questions', inputSchema: {} })
class InboxLinkTool extends ToolContext {
  async execute() {
    return questionInboxLink(this);
  }
}

@App({ name: 'deploys', tools: [ApproveDeployTool, InboxLinkTool] })
class DeploysApp {}

@FrontMcp({
  info: { name: 'deploys', version: '1.0.0' },
  apps: [DeploysApp],
  http: { port: 3000, auth: { people: 'loopback-token' } },
  auth: { mode: 'transparent', provider: 'https://idp.example.com', expectedAudience: 'https://idp.example.com' },
  elicitation: { enabled: true, persistent: true },
})
class Server {}
```

```bash
# The agent called inbox_link and passed the person its link; the person answers from a terminal
frontmcp inbox 'http://127.0.0.1:3000/_frontmcp/people/login?code=…&next=%2F_frontmcp%2Finbox'
# or, with a fresh link and the id the listing showed:
frontmcp inbox '<link>' --answer q-… --content '{"approve":true}'
```

## What This Demonstrates

- Turning on `elicitation.persistent` next to `http.auth.people` for the inbox routes
- Asking with `this.elicit(..., { ttl, persist: { key } })` so the question outlives the call
- Handing the person a sign-in link bound to the caller with `questionInboxLink(this)`
- Answering with `frontmcp inbox <link>`, and the next call receiving the answer once

`approve_deploy` waits 60 s; if nobody answers by then it fails with `QuestionPendingError`, and the question stays for a
day. The person sees the questions of that signed-in user only; another user, or a person signed in with the startup
token, sees none. The next `approve_deploy` call of the same user with the same version (another session, after a
reconnect) returns the answer at once, and only that call gets it.

## Related

- See `configure-elicitation` for every option, the inbox routes and the delivery rules
