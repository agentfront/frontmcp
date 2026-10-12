# @frontmcp/plugin-approval

A FrontMCP plugin that refuses to run a tool until an approval is recorded for the caller. Use it for tools that
shouldn't run without someone's say-so, like deleting a ticket or refunding a payment. Mark a tool with `approval`,
and every call to it is refused until your code grants an approval, through `this.approval` or the plugin's store.
Each approval records who granted it, and can be revoked or set to expire. The plugin doesn't ask anyone itself:
there's no prompt, webhook or callback, so you decide how a person says yes, for example with a form from
`this.elicit()`.

[![npm](https://img.shields.io/npm/v/@frontmcp/plugin-approval.svg)](https://www.npmjs.com/package/@frontmcp/plugin-approval) [![License](https://img.shields.io/npm/l/@frontmcp/plugin-approval.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Install

```bash
npm install @frontmcp/plugin-approval @frontmcp/sdk
```

Requires Node.js 24 or later. Keep `@frontmcp/sdk` on the same version as this package. Approvals
are kept in memory unless you configure `storage`. Redis support (`ioredis`) is included; for other stores, install
their client yourself:

- `@vercel/kv`, an optional peer dependency, for `storage: { type: 'vercel-kv' }`.
- `@upstash/redis` for `storage: { type: 'upstash' }`.

This plugin isn't part of the [`@frontmcp/plugins`](https://www.npmjs.com/package/@frontmcp/plugins) meta-package.

## Usage

Register the plugin on `@FrontMcp`, to gate every app's tools, or on an `@App`. Mark the tools that need approval,
and give the user a way to grant it:

```ts
import { ApprovalPlugin, userGrantor } from '@frontmcp/plugin-approval';
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'delete_ticket',
  description: 'Delete a support ticket for good. Needs approval: call approve_delete first.',
  inputSchema: { id: z.string() },
  approval: {
    approvalMessage: 'delete_ticket needs the user to approve it. Call approve_delete first.',
    category: 'delete',
    riskLevel: 'high',
  },
})
class DeleteTicket extends ToolContext {
  async execute({ id }: { id: string }) {
    return { id, deleted: true };
  }
}

@Tool({ name: 'approve_delete', description: 'Ask the user to allow delete_ticket for this session', inputSchema: {} })
class ApproveDelete extends ToolContext {
  async execute() {
    // The user answers this form in the client. The model can't.
    const answer = await this.elicit(
      'Allow the assistant to delete tickets in this session?',
      z.object({ allow: z.boolean() }),
    );
    if (answer.status !== 'accept' || !answer.content?.allow) return { approved: false };

    await this.approval.grantSessionApproval('help-desk:delete_ticket', {
      grantedBy: userGrantor(this.auth.user.sub),
    });
    return { approved: true };
  }
}

@App({ id: 'help-desk', name: 'Help Desk', tools: [DeleteTicket, ApproveDelete] })
class HelpDeskApp {}

@FrontMcp({
  info: { name: 'help-desk', version: '1.0.0' },
  apps: [HelpDeskApp],
  elicitation: { enabled: true },
  plugins: [ApprovalPlugin.init()],
})
export default class Server {}
```

- **Tool ids are `<app id>:<tool name>`**, like `help-desk:delete_ticket`. Granting `'delete_ticket'` records an
  approval nothing checks.
- **Approvals belong to the caller**, so use the plugin with signed-in users. An anonymous caller can get a new
  identity on every request, and an approval granted to them then never applies to their next call.
- **Don't let the model approve its own calls.** A tool that grants without asking a person makes the gate protect
  nothing. Grant after a form the user answers, as above, or from a caller with more rights.
- **A field needs its plugin.** A server where a tool has `approval` and no `ApprovalPlugin` reaches it doesn't start:
  it fails with `UnenforcedMetadataError`.
- `ApprovalPlugin.init()` with no argument, and `plugins: [ApprovalPlugin]`, use the defaults.

## What the client sees

A refused call is a tool error the model can read: `isError: true`, `_meta.code: 'APPROVAL_REQUIRED'`, and the text
of the tool's `approvalMessage`, in production too (the approval errors extend `PublicMcpError`). The default
message, `Tool "<id>" requires approval to execute. Allow?`, doesn't tell the model what to do next, so write your
own. The tool's `category`, `riskLevel` and other fields stay on the server.

## The `approval` field on `@Tool`

`approval: true` means `{ required: true, defaultScope: ApprovalScope.SESSION }`. Any object requires approval unless
it says `required: false`.

| Field                                   | What it does                                                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `required`                              | `false` turns the gate off. Default `true`.                                                                                                     |
| `skipApproval`                          | `true` turns the gate off too.                                                                                                                  |
| `alwaysPrompt`                          | Each approval lets one call run and is used up by it.                                                                                           |
| `approvalMessage`                       | The text of the refusal.                                                                                                                        |
| `allowedScopes`                         | The scopes an approval of this tool may have. A grant through `this.approval` of another scope throws `ApprovalScopeNotAllowedError`.           |
| `maxTtlMs`                              | The longest an approval of this tool lasts.                                                                                                     |
| `preApprovedContexts`                   | Lets a call run without an approval when `authInfo.extra.approvalContext` matches. FrontMCP's auth modes don't set it, so your own code has to. |
| `category`, `riskLevel`, `defaultScope` | Kept on the error's `details`, which clients don't see.                                                                                         |

## `this.approval`

The plugin adds `this.approval` to the tools, resources and prompts of the apps it's registered for. It acts for the
current caller, and takes tool ids in the `<app id>:<tool name>` form.

| Method                                                                                              | What it does                                                                 |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `isApproved(toolId, context?)`                                                                      | Whether the gate would let the caller run the tool.                          |
| `grantSessionApproval(toolId, options?)`                                                            | Approves for the caller's session.                                           |
| `grantUserApproval(toolId, options?)`                                                               | Approves for the caller in every session.                                    |
| `grantTimeLimitedApproval(toolId, ttlMs, options?)`                                                 | Approves for `ttlMs` milliseconds.                                           |
| `grantContextApproval(toolId, context, options?)`                                                   | Approves in one context, `{ type, identifier }` (see `preApprovedContexts`). |
| `revokeApproval(toolId, options?)`                                                                  | Deletes the caller's approvals of the tool, keeping a copy for 24 hours.     |
| `getRevocations(toolId)`                                                                            | The caller's approvals of the tool revoked in the last 24 hours.             |
| `getApproval`, `getSessionApprovals`, `getUserApprovals`, `queryApprovals`, `clearSessionApprovals` | Read or clear the caller's records.                                          |

Grant `options` are `{ grantedBy?, reason?, metadata? }`, and revoke options `{ revokedBy?, reason? }`. Without
`grantedBy`, a grant records the signed-in caller with `method: 'implicit'`, which says nobody was asked:
`{ source: 'user', identifier: <user id>, method: 'implicit' }`, or `{ source: 'user', method: 'implicit' }` with no
signed-in user. After the user says yes, pass a grantor that says so:

```ts
import { policyGrantor, userGrantor } from '@frontmcp/plugin-approval';

// { source: 'user', identifier: 'user-123', displayName: 'Jane Doe', method: 'interactive' }
await this.approval.grantUserApproval('ops:deploy', { grantedBy: userGrantor('user-123', 'Jane Doe') });

// { source: 'policy', identifier: 'safe-list', method: 'implicit' }
await this.approval.grantSessionApproval('ops:deploy', { grantedBy: policyGrantor('safe-list') });
```

The other grantor helpers are `adminGrantor`, `systemGrantor`, `agentGrantor`, `apiGrantor`, `oauthGrantor`,
`testGrantor` and `customGrantor`, with matching revoker helpers (`userRevoker`, `adminRevoker`, `policyRevoker`, and
others).

To grant or revoke for someone other than the caller, like a lead approving a teammate, use the store:
`this.get(ApprovalStoreToken)` returns it, with `grantApproval({ toolId, scope, userId?, sessionId?, ttlMs?, grantedBy?, ... })`
and `revokeApproval(...)`.

## Scopes

`ApprovalScope` is a string enum:

| Scope              | Value                | What it does                                                                             |
| ------------------ | -------------------- | ---------------------------------------------------------------------------------------- |
| `SESSION`          | `'session'`          | Approves for the session.                                                                |
| `USER`             | `'user'`             | Approves for the user, in every session.                                                 |
| `TIME_LIMITED`     | `'time_limited'`     | Needs a `ttlMs`, and approves until it expires.                                          |
| `CONTEXT_SPECIFIC` | `'context_specific'` | Approves only for calls in that context, which `authInfo.extra.approvalContext` carries. |
| `TOOL_SPECIFIC`    | `'tool_specific'`    | A label. Nothing in the plugin grants it.                                                |

Under MCP protocol 2026-07-28, clients have no sessions, so a session approval is kept per user and lasts until it's
revoked or expires. Grant time-limited approvals when that matters.

## Options

```ts
ApprovalPlugin.init({
  storage: { type: 'redis', redis: { url: process.env.REDIS_URL } },
});
```

| Option                   | Default            | Description                                                                                                                                                                                                    |
| ------------------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                | `{ type: 'auto' }` | Where approvals are kept: `'memory'`, `'redis'`, `'vercel-kv'`, `'upstash'`, `'cloudflare-kv'` or `'auto'`. `'auto'` picks Upstash, Vercel KV or Redis from their environment variables, and memory otherwise. |
| `storageInstance`        |                    | A storage you made with `createStorage()` from `@frontmcp/utils`. Wins over `storage`.                                                                                                                         |
| `namespace`              | `'approval'`       | The prefix of the plugin's keys.                                                                                                                                                                               |
| `cleanupIntervalSeconds` | `60`               | How often expired approvals are deleted. `0` turns it off.                                                                                                                                                     |
| `mode`                   | `'recheck'`        | `'webhook'` also registers a `ChallengeService` (below). Neither mode contacts an external system.                                                                                                             |
| `webhook.challengeTtl`   | `300`              | How long the `ChallengeService`'s challenges last, in seconds.                                                                                                                                                 |

`webhook.url`, `webhook.callbackPath`, `webhook.includeJwt`, the `recheck` options, `enableAudit` and
`maxDelegationDepth` are accepted and not used: nothing is sent, polled or served.

## Webhook mode

With `mode: 'webhook'`, `this.get(ChallengeServiceToken)` returns a `ChallengeService`: a store of one-time PKCE
(Proof Key for Code Exchange, RFC 7636) challenges you can build an external approval flow on.
`createChallenge({ toolId, sessionId, requestedScope, requestInfo, ... })` returns a code verifier and its SHA-256
challenge, and `verifyAndConsume(codeVerifier)` returns the stored request once, or throws `ChallengeValidationError`.
The plugin itself doesn't call it, send a webhook or serve a callback route.

## Docs

- [Approval plugin reference](https://frontmcp.dev/reference/plugins/approval): every option, method, error and
  caveat, with runnable examples
- [Asking for Approval](https://frontmcp.dev/learn/asking-for-approval): builds the gate and the asking step by step
- [Plugins and adapters](https://frontmcp.dev/reference/plugins): where to register a plugin

## Related packages

- [`@frontmcp/sdk`](https://www.npmjs.com/package/@frontmcp/sdk): the framework this plugin extends
- [`@frontmcp/plugin-feature-flags`](https://www.npmjs.com/package/@frontmcp/plugin-feature-flags): hides and blocks
  tools behind feature flags
- [`@frontmcp/plugin-remember`](https://www.npmjs.com/package/@frontmcp/plugin-remember): `this.remember`, a memory
  for tools

## Contributing

Source: [`plugins/plugin-approval`](https://github.com/agentfront/frontmcp/tree/main/plugins/plugin-approval). Issues
and pull requests are welcome; see [CONTRIBUTING.md](https://github.com/agentfront/frontmcp/blob/main/CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](https://github.com/agentfront/frontmcp/blob/main/LICENSE).
