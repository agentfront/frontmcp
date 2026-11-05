---
name: 15-tool-with-credential-vault
level: advanced
description: "Tool that reads a user-supplied static credential (a Slack webhook URL) from the per-session encrypted credential vault — the pattern for credentials that aren't OAuth."
tags: [auth-providers, credential-vault, slack-webhook, encryption-at-rest, this.credentials]
features:
  - "Declaring the credential the tool needs with `authProviders: ['slack-webhook']`, so a caller who hasn't connected it gets `-32001` with the connect URL before `execute()` runs"
  - "Storing the user's pasted-in webhook URL in the session credential vault from local mode's `authenticate()`, and reading it with `await this.credentials.get('slack-webhook')`"
  - Letting the framework handle per-session AES-256-GCM encryption at rest (memory, Redis or SQLite `tokenStorage`)
  - Knowing when to pick the session credential vault (secrets the user types in) vs `authProvidersVault` (credentials the server acquires)
---

# Tool With Credential Vault

Tool that reads a user-supplied static credential (a Slack webhook URL) from the per-session encrypted credential vault — the pattern for credentials that aren't OAuth.

For credentials the user types in — webhook URLs, API keys, custom tokens — use the session credential vault, `this.credentials`. Local mode's `authenticate()` stores them, encrypted for the session, and `@Tool({ authProviders })` checks them before `execute()` runs.

## Code

```typescript
// src/apps/main/tools/send-to-slack.tool.ts
import { PublicMcpError, Tool, ToolContext, z } from '@frontmcp/sdk';

const inputSchema = {
  channel: z.string().regex(/^#/).describe('Slack channel, e.g. #ops'),
  text: z.string().min(1).max(4_000),
  username: z.string().optional(),
  iconEmoji: z.string().optional(),
};
const outputSchema = { sent: z.boolean(), channel: z.string() };

@Tool({
  name: 'send_to_slack',
  description: 'Send a message to a Slack channel via the user-supplied incoming-webhook URL',
  inputSchema,
  outputSchema,
  authProviders: ['slack-webhook'], // required: a caller without it gets -32001 and the connect URL
  annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
})
export class SendToSlackTool extends ToolContext {
  async execute(input: { channel: string; text: string; username?: string; iconEmoji?: string }) {
    // `{ secret, metadata }`, decrypted for this session's subject; undefined when not connected.
    const webhook = await this.credentials.get('slack-webhook');
    if (!webhook) this.fail(new PublicMcpError('Connect your Slack webhook and retry'));

    const response = await this.fetch(webhook.secret, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channel: input.channel,
        text: input.text,
        username: input.username,
        icon_emoji: input.iconEmoji,
      }),
    });

    if (!response.ok) {
      this.fail(new PublicMcpError(`Slack webhook returned ${response.status}`));
    }

    return { sent: true, channel: input.channel };
  }
}
```

```typescript
// src/server.ts
import { FrontMcp } from '@frontmcp/sdk';

import { MainApp } from './apps/main';

@FrontMcp({
  info: { name: 'slack-tools', version: '1.0.0' },
  apps: [MainApp],
  auth: {
    mode: 'local',
    login: {
      title: 'Connect Slack',
      fields: { webhookUrl: { type: 'password', label: 'Slack incoming-webhook URL', required: true } },
      subject: { fromField: 'webhookUrl', strategy: 'per-account' },
    },
    authenticate: async ({ fields, resume }) => {
      const webhookUrl = fields['webhookUrl'];
      if (!webhookUrl?.startsWith('https://hooks.slack.com/')) {
        return { ok: false, message: 'Paste a Slack incoming-webhook URL', retryField: 'webhookUrl' };
      }
      // At sign-in, and again when the caller opens the connect URL of a -32001 (`resume` is set then).
      return { ok: true, credentials: [{ key: resume?.key ?? 'slack-webhook', secret: webhookUrl }] };
    },
  },
})
export default class Server {}
```

## What This Demonstrates

- Declaring the credential the tool needs with `authProviders: ['slack-webhook']`, so a caller who hasn't connected it gets `-32001` with the connect URL before `execute()` runs
- Storing the user's pasted-in webhook URL in the session credential vault from local mode's `authenticate()`, and reading it with `await this.credentials.get('slack-webhook')`
- Letting the framework handle per-session AES-256-GCM encryption at rest (memory, Redis or SQLite `tokenStorage`)
- Knowing when to pick the session credential vault (secrets the user types in) vs `authProvidersVault` (credentials the server acquires)

## Session credential vault vs `authProvidersVault`

| Session credential vault (`this.credentials`)                     | `authProvidersVault` (`this.authProviders`)                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| The user types the secret in: at sign-in, or from the connect URL | The server acquires it: a `factory` you register per provider                  |
| Filled by local mode's `authenticate()` returning `credentials`   | `@FrontMcp({ authProvidersVault: { providers: [{ name, scope, factory }] } })` |
| Encrypted per session, in the `auth.tokenStorage` backend         | Cached for the request (and a verified session), not stored                    |
| A missing one gets `-32001` with a connect URL                    | A factory returning `null` gets `-32001`                                       |

`@Tool({ authProviders })` checks both: the `authProvidersVault` provider of that name first, then the session
credential vault's key. See `13-tool-with-single-auth-provider` for `authProvidersVault`, and the `configure-auth`
reference for the session credential vault, its encryption key and `requireConnect()`.
