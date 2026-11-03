---
name: persistent-questions-inbox
reference: configure-elicitation
level: advanced
description: 'Keep a question for its caller past the session, answered in the inbox or the CLI.'
tags: [config, elicitation, persistent, inbox, people-auth]
features:
  - 'Turning on `elicitation.persistent` next to `http.auth.people` for the inbox routes'
  - 'Asking with `this.elicit(..., { ttl, persist: { key } })` so the question outlives the call'
  - 'Printing a sign-in link bound to the caller on the server console with `printQuestionInboxLink(this)`'
  - 'Answering with `frontmcp inbox --url <server>`, which reads the link from the prompt, stdin or `FRONTMCP_INBOX_LINK`, and the next call receiving the answer once'
---

# Persistent Questions with an Inbox

Keep a question for its caller past the session, answered in the inbox or the CLI.

## Code

```typescript
// src/server.ts
import { App, FrontMcp, printQuestionInboxLink, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'approve_deploy',
  description: 'Ask the person to approve a deploy; the question waits for them',
  inputSchema: { version: z.string() },
  outputSchema: { approved: z.boolean() },
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

@Tool({
  name: 'inbox_link',
  description: 'Print a sign-in link to my questions on the server console',
  inputSchema: {},
  outputSchema: { expiresAt: z.number() },
})
class InboxLinkTool extends ToolContext {
  async execute() {
    return printQuestionInboxLink(this);
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
# The agent called inbox_link; the person copies the link from the server's terminal and pastes it when asked,
# so the one-time code shows in no process list or shell history
frontmcp inbox --url http://127.0.0.1:3000
# or, with a fresh link in FRONTMCP_INBOX_LINK (or piped in) and the id the listing showed:
frontmcp inbox --url http://127.0.0.1:3000 --answer q-… --content '{"approve":true}'
```

## What This Demonstrates

- Turning on `elicitation.persistent` next to `http.auth.people` for the inbox routes
- Asking with `this.elicit(..., { ttl, persist: { key } })` so the question outlives the call
- Printing a sign-in link bound to the caller on the server console with `printQuestionInboxLink(this)`
- Answering with `frontmcp inbox --url <server>`, which reads the link from the prompt, stdin or `FRONTMCP_INBOX_LINK`, and the next call receiving the answer once

`approve_deploy` waits 60 s; if nobody answers by then it fails with `QuestionPendingError`, and the question stays for a
day. `inbox_link` prints only while the server's stderr is a terminal (`elicitation.persistent.inboxLinks: 'terminal'`):
output a client, a log or an agent captures would let its reader answer the questions. The person sees the questions of that signed-in user only; another user, or a person signed in with the startup
token, sees none. The next `approve_deploy` call of the same user with the same version (another session, after a
reconnect) returns the answer at once, and only that call gets it.

## Related

- See `configure-elicitation` for every option, the inbox routes and the delivery rules
