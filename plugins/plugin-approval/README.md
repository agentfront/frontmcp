# @frontmcp/plugin-approval

A FrontMCP plugin that refuses to run a tool until an approval is recorded for the caller. Use it for tools that
shouldn't run without someone's say-so, like deleting a ticket or refunding a payment. Mark a tool with `approval`,
and every call to it is refused until your code grants an approval, through `this.approval` or the plugin's store.
Each approval records who granted it, and can be revoked or set to expire. You decide how a person says yes: with a
form from `this.elicit()`, or with an external approval system the plugin asks for you, by
[webhook](#webhook-mode) or by [polling](#recheck-mode).

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
| `mode`                   | `'recheck'`        | `'recheck'` polls `recheck.url` when it is set; `'webhook'` registers a `ChallengeService` and sends requests to `webhook.url` when it is set. Without a URL, neither contacts an external system.             |
| `recheck`                |                    | See [Recheck mode](#recheck-mode).                                                                                                                                                                             |
| `webhook`                |                    | See [Webhook mode](#webhook-mode). `webhook.challengeTtl` (default `300`) is how long a challenge lasts, in seconds.                                                                                           |
| `enableAudit`            | `false`            | Logs an [audit trail](#audit-trail).                                                                                                                                                                           |
| `maxDelegationDepth`     | `3`                | The deepest [delegation chain](#delegation-chains) a delegated approval may name, 0 to 64.                                                                                                                     |

In a browser build (`create()` in a web page, WebMCP), `storage: { type: 'redis' }` or `{ type: 'sqlite' }` throws
`BrowserStoreUnavailableError` from `init()`, naming `storage: { type: 'memory' }`: a page has no TCP socket and no
file. `{ type: 'auto' }` picks memory there.

## Audit trail

With `enableAudit: true`, the plugin logs one `info` line (logger `ApprovalAudit`) per event. The message is
`<event> <toolId>`, and the first argument holds the fields:

| Event                | When                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `approval.requested` | A call had no approval it could use. `state`: `pending`, `expired`, `denied`, or `approved` by the recheck system; `via`: `webhook` or `recheck`. |
| `approval.granted`   | An approval was recorded: by `this.approval`, the store, a webhook callback or a recheck answer.                                                  |
| `approval.denied`    | A denial was recorded.                                                                                                                            |
| `approval.revoked`   | An approval was revoked (`revokedBy`, `reason`), or a session's approvals were cleared (`count`).                                                 |
| `approval.expired`   | The cleanup deleted an expired approval or denial.                                                                                                |

The fields are the tool, scope, user id, context, grantor or revoker, reason and `expiresAt`. A line never carries a
session id, a token or a record's `metadata`. A backend that expires keys itself, such as Redis, can delete an expired
record before the cleanup sees it; `approval.granted` carries its `expiresAt`.

It is off by default: up to 1.11.2 the option did nothing (its documented default was `true`), and turning it on adds
lines with user ids to your logs. Route them with a log transport.

## Delegation chains

A delegated approval names who authorized whom: `grantedBy.delegationContext`, `{ delegatorId, delegateId, purpose?,
constraints?, chain? }`. A delegate can delegate further: `chain` lists the delegations above it, the original
delegator's first, and `extendDelegation()` builds the next one.

```ts
import { agentGrantor, extendDelegation } from '@frontmcp/plugin-approval';

const toPlanner = { delegatorId: 'user-123', delegateId: 'planner-agent', purpose: 'release' };
const toDeployer = extendDelegation(toPlanner, 'deploy-agent', { purpose: 'deploy step' });
// { delegatorId: 'planner-agent', delegateId: 'deploy-agent', purpose: 'deploy step',
//   chain: [{ delegatorId: 'user-123', delegateId: 'planner-agent', purpose: 'release' }] }

await this.approval.grantSessionApproval('ops:deploy', { grantedBy: agentGrantor('deploy-agent', toDeployer) });
```

`maxDelegationDepth` (default `3`) bounds the chain, counting the delegation itself: `toPlanner` is 1 deep,
`toDeployer` 2. A grant whose chain is deeper, broken (a delegator that isn't the previous delegate) or names a party
twice throws `ApprovalOperationError`, and a stored approval like that doesn't let a call through. Denials are kept
whatever their chain. `maxDelegationDepth: 1` allows direct delegation only, and `0` no delegated approval.
`delegationDepth(context)` and `delegationProblem(context, maxDepth)` check a context yourself. Up to 1.11.2 the option
did nothing.

## Webhook mode

With `mode: 'webhook'` and `webhook.url`, a call that needs an approval it doesn't have sends a signed approval request
to your approval system (a Slack app, a ticketing system, an admin console), and is refused as `pending`. The system
decides by POSTing back to `webhook.callbackPath`, and the caller's next call runs, or is refused as `denied`.

```ts
ApprovalPlugin.init({
  storage: { type: 'redis', redis: { url: process.env.REDIS_URL } },
  mode: 'webhook',
  webhook: {
    url: 'https://approvals.example.com/webhook',
    secret: process.env.APPROVAL_WEBHOOK_SECRET, // required with url, at least 24 bytes
    challengeTtl: 300,
    callbackPath: '/approval/callback',
  },
});
```

| Option                 | Default                | Description                                                                                                                                      |
| ---------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `webhook.url`          |                        | Where requests are POSTed. `https://`; `http://localhost`, `127.0.0.1` or `[::1]` only when `NODE_ENV` isn't `production`. No credentials in it. |
| `webhook.secret`       |                        | Signs each request and verifies each callback. Required with `url`. A `whsec_` secret (Standard Webhooks) is base64 after the prefix.            |
| `webhook.includeJwt`   | `false`                | Adds the caller's access token to the request as `jwt`. Set it only when the approval system must act as the caller.                             |
| `webhook.challengeTtl` | `300`                  | Seconds a request waits for its decision, and a denial without `ttlMs` lasts.                                                                    |
| `webhook.callbackPath` | `'/approval/callback'` | The path the server takes decisions on (`POST`).                                                                                                 |

The request, sent once per caller and tool until it is decided or `challengeTtl` passes:

```json
{
  "type": "approval.requested",
  "codeChallenge": "…",
  "codeVerifier": "…",
  "toolId": "ops:delete_ticket",
  "toolName": "delete_ticket",
  "category": "delete",
  "riskLevel": "high",
  "approvalMessage": "…",
  "requestedScope": "session",
  "userId": "user-123",
  "callbackPath": "/approval/callback",
  "callbackUrl": "https://mcp.example.com/approval/callback",
  "expiresAt": 1700000300000,
  "timestamp": 1700000000000
}
```

It never names the session. `callbackUrl` is there when `FRONTMCP_PUBLIC_URL` is set; `allowedScopes` and `maxTtlMs`
when the tool limits them; `jwt` only with `includeJwt: true`. Keep `codeVerifier` secret: it is what decides the
request. A request that fails (an error status, a redirect, no answer in 10 seconds) is sent again by the next call.

The decision, POSTed to `callbackPath` and signed with the same secret:

```json
{
  "codeVerifier": "…",
  "approved": true,
  "scope": "session",
  "ttlMs": 3600000,
  "grantedBy": { "source": "user", "identifier": "lead-7" },
  "reason": "ok"
}
```

- An approval is recorded for the caller the request was for, never one the body names, held to the tool's
  `allowedScopes` and `maxTtlMs` (`scope` defaults to `requestedScope`), with `grantedBy` and `origin: 'webhook'`. A
  denial (`approved: false`) is recorded for the caller's session, and lasts `ttlMs`, or `challengeTtl` without it.
- Each `codeVerifier` works once, until `challengeTtl` passes. A replayed or late decision does nothing.
- Every signed, well-formed callback gets `202 { "status": "received" }`, whether or not it matched a request, so the
  route never says whether an approval is pending. An unsigned or mis-signed callback, or one signed more than five
  minutes ago, gets `401`; a body that isn't a decision `400`; one over 16 KB `413`.

Requests and callbacks are signed with HMAC-SHA256 in the [Standard Webhooks](https://www.standardwebhooks.com)
format, so any Standard Webhooks library checks them: headers `webhook-id`, `webhook-timestamp` (Unix seconds) and
`webhook-signature: v1,<base64>`, over `<webhook-id>.<webhook-timestamp>.<body>`. Check the timestamp on your side too,
and reject a `webhook-id` you have seen.

`this.get(ChallengeServiceToken)` returns the plugin's `ChallengeService`, the store of these one-time PKCE (Proof Key
for Code Exchange, RFC 7636) challenges: `createChallenge(...)`, `consume(codeVerifier)` (the request once, or
`undefined`) and `verifyAndConsume(codeVerifier)` (the request once, or `ChallengeValidationError`).

## Recheck mode

With `mode: 'recheck'` (the default) and `recheck.url`, a call that needs an approval it doesn't have polls your
approval API until it decides.

```ts
ApprovalPlugin.init({
  recheck: {
    url: 'https://approvals.example.com/status',
    auth: 'bearer',
    token: process.env.APPROVALS_API_TOKEN,
    interval: 2000,
    maxAttempts: 5,
  },
});
```

| Option                | Default  | Description                                                                                                                                                                          |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `recheck.url`         |          | The status URL, with the same rules as `webhook.url`.                                                                                                                                |
| `recheck.auth`        | `'none'` | `'bearer'` sends `recheck.token`; `'jwt'` forwards the caller's own access token (a call without one isn't polled); `'custom'` sends the headers `recheck.headers(request)` returns. |
| `recheck.token`       |          | The token `auth: 'bearer'` sends.                                                                                                                                                    |
| `recheck.headers`     |          | `(request) => headers`, for `auth: 'custom'`.                                                                                                                                        |
| `recheck.secret`      |          | Signs each poll as webhook requests are signed.                                                                                                                                      |
| `recheck.interval`    | `2000`   | Milliseconds between polls, 100 to 60000.                                                                                                                                            |
| `recheck.maxAttempts` | `5`      | Polls per call, 1 to 60. `interval × (maxAttempts − 1)` is at most 2 minutes.                                                                                                        |

Each poll POSTs `{ type: 'approval.status', requestId, attempt, toolId, toolName, userId?, requestedScope, ... }`
(`requestId` is the same for every poll of one caller and tool, and names neither), and reads
`{ approved, pending?, scope?, ttlMs?, grantedBy?, denialReason? }`:

- `{ "approved": true }` records an approval, as a webhook approval is recorded but with `origin: 'recheck'`, and the
  call runs. An `alwaysPrompt` tool's approval lets that call alone through, and isn't stored.
- `{ "approved": false, "pending": true }` polls again after `interval`; after `maxAttempts` polls the call is refused as
  `pending`.
- `{ "approved": false }` refuses the call as `denied`. Nothing is stored: the next call polls again.
- An error status, a redirect, a body that isn't such an answer, more than 64 KB, or no answer in 10 seconds refuses the
  call as `pending`, and logs a warning that names only the URL's origin.

A recorded denial refuses a call before anything is polled or sent, in both modes.

## Startup checks

`ApprovalPlugin.init()` throws `ApprovalConfigurationError` (code `APPROVAL_CONFIGURATION`), and the server doesn't
start, for options that can't work: `webhook.url` without `webhook.secret`, or a secret under 24 bytes; `webhook.*`
(other than `challengeTtl`) outside `mode: 'webhook'` or without `webhook.url`; `recheck` in `mode: 'webhook'` or
without `recheck.url`; a URL that isn't `https://` (or loopback outside production), or has credentials in it;
`auth: 'bearer'` without `token`, `auth: 'custom'` without `headers`, or either one set for another `auth`; an
`interval` or `maxAttempts` out of range; and a `callbackPath` that isn't a plain path, that the server reserves (the
MCP endpoint, `/oauth/*`, `/.well-known/*`), or that another `ApprovalPlugin` serves. Up to 1.11.2 these options were
accepted and ignored.

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
