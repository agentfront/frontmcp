---
name: 15-tool-with-credential-vault
level: advanced
description: "Tool that reads a user-supplied static credential (a Slack webhook URL) from the per-session encrypted credential vault — the pattern for credentials that aren't OAuth."
tags: [auth-providers, credential-vault, slack-webhook, encryption-at-rest]
features:
  - "Declaring a vault-backed auth provider with `authProviders: ['slack-webhook']`"
  - "Reading the user's pasted-in credential via `await this.authProviders.headers('slack-webhook')` — same API as OAuth"
  - Letting the framework handle per-session AES-256-GCM encryption at rest (Redis or memory store)
  - Knowing when to pick the vault (static secrets the user knows) vs OAuth (delegated identity)
---

# Tool With Credential Vault

Tool that reads a user-supplied static credential (a Slack webhook URL) from the per-session encrypted credential vault — the pattern for credentials that aren't OAuth.

For credentials that aren't OAuth — webhook URLs, API keys the user pastes in, custom tokens — use a vault-backed auth provider. Same API as OAuth from the tool's perspective; the framework handles per-session encryption and key derivation.

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
  authProviders: ['slack-webhook'], // vault-backed provider — see auth skill
  annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
})
export class SendToSlackTool extends ToolContext {
  async execute(input: { channel: string; text: string; username?: string; iconEmoji?: string }) {
    const headers = await this.authProviders.headers('slack-webhook');
    // `headers` is a plain `Record<string, string>` (NOT a `Headers` object), e.g.:
    //   { 'x-slack-webhook-url': 'https://hooks.slack.com/services/T.../B.../...' }
    // Read values with string-index access (`headers['x-...']`), not `headers.get(...)`.
    // The framework reads the value from the vault, decrypts with the per-session AES-256-GCM
    // key, and never returns the raw value — it's only available indirectly via these headers.

    // Reading the key directly is safe here because we declared `authProviders: ['slack-webhook']`
    // (required: true by default), so the framework already rejected the call before `execute()`
    // if the vault entry was missing — by the time we read the header, the provider is guaranteed
    // to have produced it. If you ever switch the provider to `required: false`, `headers` will be
    // an empty object `{}` when no credential is set, so guard with
    // `if (!webhookUrl) this.fail(new PublicMcpError('No Slack webhook configured'))` instead.
    const webhookUrl = headers['x-slack-webhook-url'];
    const response = await this.fetch(webhookUrl, {
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

## What This Demonstrates

- Declaring a vault-backed auth provider with `authProviders: ['slack-webhook']`
- Reading the user's pasted-in credential via `await this.authProviders.headers('slack-webhook')` — same API as OAuth
- Letting the framework handle per-session AES-256-GCM encryption at rest (Redis or memory store)
- Knowing when to pick the vault (static secrets the user knows) vs OAuth (delegated identity)

## Vault vs OAuth — when to pick which

| Vault-backed                                                                 | OAuth                                                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| User pastes in a webhook URL, API key, or token they own                     | User clicks "Connect to GitHub" — provider issues a token to your server |
| Static — doesn't refresh, doesn't expire                                     | Refresh token + access token + expiration                                |
| Per-session — gone when the session ends (vs. Redis store, then it survives) | Long-lived — usually persists across sessions                            |
| For "bring your own" integrations (Slack webhooks, custom API keys)          | For "log in with" integrations (GitHub, Google, Microsoft)               |

## How vault-backed providers are configured

Server side, in the `auth` skill:

```typescript
@FrontMcp({
  auth: {
    providers: [
      {
        name: 'slack-webhook',
        kind: 'vault',
        fields: [
          { name: 'webhook-url', type: 'url', label: 'Slack incoming-webhook URL', required: true },
        ],
      },
    ],
  },
})
```

The framework renders the credential UI based on `fields`, encrypts the user's input, stores it per-session, and exposes it back to tools via `this.authProviders.headers('slack-webhook')`.

See the `auth` skill for full vault configuration, encryption-key management, Redis-backed storage, and the credential UI.
