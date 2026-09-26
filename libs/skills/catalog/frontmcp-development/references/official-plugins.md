---
name: official-plugins
description: Guide to the 6 official plugins for discovery, memory, auth, caching, flags, and monitoring
---

# Official FrontMCP Plugins

FrontMCP ships 6 official plugins that extend server behavior with cross-cutting concerns: semantic tool discovery, session memory, authorization workflows, result caching, feature gating, and visual monitoring. Install individually or via `@frontmcp/plugins` (meta-package re-exporting cache, codecall, and remember).

> **Note:** The Dashboard plugin (`@frontmcp/plugin-dashboard`) is currently in **beta** and may not work correctly in all environments. It is not recommended for production use at this time.

## When to Use This Skill

### Must Use

- Installing and configuring any official FrontMCP plugin (CodeCall, Remember, Approval, Cache, Feature Flags)
- Adding session memory, tool caching, or authorization workflows to an existing server
- Integrating feature flag services (LaunchDarkly, Split.io, Unleash) to gate tools at runtime

### Recommended

- Exploring the Dashboard plugin for visual monitoring (beta — not recommended for production)
- Configuring CodeCall for semantic tool discovery when the server has many tools
- Combining multiple official plugins in a production deployment

### Skip When

- You need to build a custom plugin with your own providers and context extensions (see `create-plugin`)
- You only need lifecycle hooks without installing an official plugin (see `create-plugin-hooks`)
- You need to generate tools from an OpenAPI spec (see `official-adapters`)

> **Decision:** Use this skill when you need to install, configure, or customize one or more of the 5 stable official FrontMCP plugins. The Dashboard plugin is in beta — see its section below for details.

All plugins follow the `DynamicPlugin` pattern and are registered via `@FrontMcp({ plugins: [...] })`.

```typescript
import { ApprovalPlugin } from '@frontmcp/plugin-approval';
import CachePlugin from '@frontmcp/plugin-cache';
import CodeCallPlugin from '@frontmcp/plugin-codecall';
import FeatureFlagPlugin from '@frontmcp/plugin-feature-flags';
import RememberPlugin from '@frontmcp/plugin-remember';
import { FrontMcp } from '@frontmcp/sdk';

// import DashboardPlugin from '@frontmcp/plugin-dashboard'; // Beta — not recommended for production

@App({ name: 'MyApp' })
class MyApp {}

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  plugins: [
    CodeCallPlugin.init({ mode: 'codecall_only', vm: { preset: 'secure' } }),
    RememberPlugin.init({ type: 'memory' }),
    ApprovalPlugin.init({ mode: 'recheck' }),
    CachePlugin.init({ type: 'memory', defaultTTL: 86400 }),
    FeatureFlagPlugin.init({ adapter: 'static', flags: { 'new-tool': true } }),
    // DashboardPlugin.init({ enabled: true }), // Beta — see Dashboard section below
  ],
  tools: [
    /* your tools */
  ],
})
class MyServer {}
```

---

## 1. CodeCall Plugin (`@frontmcp/plugin-codecall`)

Meta-tools for semantic search and sandboxed VM execution of tools. The AI discovers, describes, and orchestrates your tools via AgentScript instead of calling them individually.

### Installation

```typescript
import CodeCallPlugin from '@frontmcp/plugin-codecall';

@FrontMcp({
  plugins: [
    CodeCallPlugin.init({
      mode: 'codecall_only', // 'codecall_only' | 'codecall_opt_in' | 'metadata_driven'
      topK: 8, // Number of search results returned
      maxDefinitions: 8, // Max tool definitions per describe call
      vm: {
        preset: 'secure', // 'locked_down' | 'secure' | 'balanced' | 'experimental'
        timeoutMs: 5000,
        allowLoops: false,
      },
      embedding: {
        strategy: 'tfidf', // 'tfidf' | 'ml'
        synonymExpansion: { enabled: true },
      },
    }),
  ],
})
class MyServer {}
```

### Modes

- `codecall_only` -- Hides all tools from `list_tools` except CodeCall meta-tools. All other tools are discovered only via `codecall:search`. Best when the server has a large number of tools and you want the AI to search-then-execute. When `appIds` is set, only tools from those apps are hidden — tools from other apps remain visible.
- `codecall_opt_in` -- Shows all tools in `list_tools` normally. Tools opt-in to CodeCall execution via metadata. Useful when only some tools benefit from orchestrated execution.
- `metadata_driven` -- Per-tool `metadata.codecall` controls visibility and CodeCall availability independently. Most granular control.

### Multi-App Scoping

Use `appIds` to scope CodeCall to specific apps in a multi-app server:

```typescript
// Only hide ecommerce tools — calc tools remain visible in list_tools
CodeCallPlugin.init({
  mode: 'codecall_only',
  appIds: ['ecommerce'],
  vm: { preset: 'secure' },
});
```

Without `appIds`, `codecall_only` mode hides ALL tools in the server. With `appIds`, only tools from the specified apps are hidden — tools from other apps remain directly callable.

### VM Presets

The sandboxed VM runs AgentScript (a restricted JavaScript subset). Presets control security boundaries:

- `locked_down` -- Most restrictive. No loops, no console, minimal builtins. Suitable for untrusted environments.
- `secure` -- Default. Reasonable limits for production use. Loops disabled, console available.
- `balanced` -- Relaxed constraints for development. Loops allowed with iteration limits.
- `experimental` -- Minimal restrictions. Full loop support, extended builtins. Development only.

### Meta-Tools Exposed

CodeCall contributes 4 tools to your server:

- `codecall:search` -- Semantic search over all registered tools using TF-IDF scoring with synonym expansion. Input: `{ queries: string[] }` (array of atomic action phrases, max 10). Decompose complex requests into simple actions (e.g., "delete users and send email" becomes `queries: ["delete user", "send email"]`). Returns ranked tool names, descriptions, and relevance scores.
- `codecall:describe` -- Returns full input/output JSON schemas for one or more tools. Input: `{ toolNames: string[] }` (tool names from search results). Use after search to understand tool interfaces before execution. If `notFound` array is non-empty in the response, re-search with corrected queries.
- `codecall:execute` -- Runs an AgentScript program in the sandboxed VM. Input: `{ script: string }` (AgentScript code). Use `callTool(name, args)` to invoke tools within scripts. The script can call multiple tools, branch on results, and compose outputs.
- `codecall:invoke` -- Direct single-tool invocation (available when `directCalls` is enabled). Bypasses the VM for simple one-shot calls.

### Per-Tool CodeCall Metadata

Control how individual tools interact with CodeCall:

```typescript
@Tool({
  name: 'my_tool',
  codecall: {
    visibleInListTools: false, // Hide from list_tools (only discoverable via codecall:search)
    enabledInCodeCall: true, // Available for execution via codecall:execute
    tags: ['data', 'query'], // Extra indexing hints for semantic search
  },
})
class MyTool extends ToolContext {
  /* ... */
}
```

### Tool Access Policy

One policy decides every CodeCall surface: `codecall:search`, `codecall:describe`, `callTool`/`getTool` and the namespace bindings in `codecall:execute`, and `codecall:invoke`. A withheld tool is not indexed, is reported in describe's `notFound`, and is refused at execution.

```typescript
CodeCallPlugin.init({
  mode: 'codecall_only',
  // `tool` is { name, appId, source, description, tags }; `name` is the tool's own name, never `<appId>:<name>`
  includeTools: (tool) => !tool.name.startsWith('admin:'),
  directCalls: {
    enabled: true,
    allowedTools: ['users:list', 'crm:users:get'], // bare name, or `<appId>:<name>` to pin one app
  },
});
```

- Always withheld: `enabledInCodeCall: false` tools, hidden tools (`visibility: 'hidden'` / `hideFromDiscovery`), `visibility: 'internal'` tools, `codecall:*`, and any tool whose name, qualified name or requested spelling starts with `system:`, `internal:` or `__`.
- `tool.appId` names the owning app for the tools its adapters and plugins provide too, so `includeTools: (tool) => tool.appId !== 'admin'` withholds every tool of app `admin`.
- `codecall:searchSkills` and `codecall:searchKnowledge` run the SDK's `skills:filter` flow, so a skill a plugin withholds there (a flag-disabled skill, for one) is absent from both.
- `directCalls.allowedTools` and `directCalls.filter` only narrow the base policy; listing a withheld tool does not make it callable. Unlisted tools are refused.
- Hiding a tool from search is not the control; the refusal at execution is. Do not rely on `visibleInListTools` or search ranking to protect a tool.

### Power Features

- **TF-IDF Search** -- Term frequency-inverse document frequency scoring indexes tool names, descriptions, and tags. No external embedding service required.
- **Synonym Expansion** -- Automatically expands search queries with synonyms (e.g., "delete" also matches "remove", "erase"). Enable via `embedding.synonymExpansion.enabled`.
- **Pass-by-Reference via Sidecar** -- Large results are stored in a sidecar map and passed by reference between tool calls in AgentScript, avoiding serialization overhead.

---

## 2. Remember Plugin (`@frontmcp/plugin-remember`)

Encrypted session memory with multi-scope persistence. Tools can remember values across invocations and sessions using a human-friendly API.

### Installation

```typescript
import RememberPlugin from '@frontmcp/plugin-remember';

// In-memory (development)
@FrontMcp({
  plugins: [RememberPlugin.init({ type: 'memory' })],
})
class DevServer {}

// Redis (production)
@FrontMcp({
  plugins: [
    RememberPlugin.init({
      type: 'redis',
      config: { host: 'localhost', port: 6379 },
      keyPrefix: 'remember:',
      encryption: { enabled: true },
      tools: { enabled: true }, // Expose LLM tools
    }),
  ],
})
class ProdServer {}

// Redis client (bring your own ioredis instance)
@FrontMcp({
  plugins: [
    RememberPlugin.init({
      type: 'redis-client',
      client: existingRedisClient,
    }),
  ],
})
class ClientServer {}

// Vercel KV
@FrontMcp({
  plugins: [RememberPlugin.init({ type: 'vercel-kv' })],
})
class VercelServer {}

// Global store (uses @FrontMcp redis config)
@FrontMcp({
  redis: { host: 'localhost', port: 6379 },
  plugins: [RememberPlugin.init({ type: 'global-store' })],
})
class GlobalStoreServer {}
```

### Storage Types

- `memory` -- In-process Map. Fastest, no persistence. Good for development.
- `redis` -- Dedicated Redis connection. Plugin manages the client lifecycle.
- `redis-client` -- Bring your own ioredis client instance.
- `vercel-kv` -- Vercel KV (Redis-compatible). Uses `@vercel/kv` package.
- `global-store` -- Reuses the Redis connection from `@FrontMcp({ redis: {...} })`.

### Using `this.remember` in Tools

```typescript
@Tool({ name: 'my_tool' })
class MyTool extends ToolContext {
  async execute(input: { query: string }) {
    // Store values (default scope: 'session')
    await this.remember.set('theme', 'dark');
    await this.remember.set('language', 'en', { scope: 'user' });
    await this.remember.set('temp_token', 'xyz', { ttl: 300 });

    // Retrieve values
    const theme = await this.remember.get('theme', { defaultValue: 'light' });

    // Check existence
    if (await this.remember.knows('onboarding_complete')) {
      // Skip onboarding
    }

    // Remove values
    await this.remember.forget('temp_token');

    // List keys matching pattern
    const keys = await this.remember.list({ pattern: 'user:*' });

    return { content: [{ type: 'text', text: `Theme: ${theme}` }] };
  }
}
```

### Memory Scopes

- `session` -- Valid only for the current session. Default scope. Cleared when the session ends.
- `user` -- Persists for the user across sessions. Tied to user identity.
- `tool` -- Scoped to a specific tool + session combination. Isolated per tool.
- `global` -- Shared across all sessions and users. Use carefully.

**`session`, `tool`, and `user` scopes require a per-client identity.** A stateless HTTP
transport injects the same session id (`__stateless__`) into every request, so it carries no
session identity. `session` and `tool` scope fall back to the authenticated principal, and an
unauthenticated stateless request is refused with a `RememberIdentityError` rather than given
a namespace shared with every other client. `user` scope is refused with no authenticated
user. If the data really is shared, use `scope: 'global'`.

**Set `REMEMBER_SECRET` on every instance that shares a store.** All scopes, `session` and
`tool` included, derive their encryption key from that secret plus the scope identity. A
session id is not a secret -- the client knows it and it travels in the `mcp-session-id`
header -- so it cannot be the key material on its own. Instances with different secrets cannot
read each other's entries. With none of `REMEMBER_SECRET`, `MCP_MEMORY_SECRET` or
`MCP_SESSION_SECRET` set in production, the plugin falls back to a random in-memory secret and
logs a warning once; its encrypted memory is then lost on restart.

**Upgrading past that change moves existing `session`, `tool` and `user` entries.** The key
derivation change orphans `session` and `tool` ciphertext, and the namespace now percent-encodes
every variable component, which moves any identity containing an escaped character (a `:` in a
user id, say). Both failures are silent on their own: decryption returns `null` and a moved key
simply misses, so the value reads as absent.

These three scopes are stored under a `v2:` segment (`remember:v2:session:<identity>:<key>`) and
the plugin **purges the pre-`v2` entries automatically**, warning with the number removed. The
version segment is what makes that safe -- a purge pattern of `remember:session:*` cannot match a
live `remember:v2:session:*` key. `global` is not versioned and not purged: neither its keys nor
its key derivation changed.

**The purge runs 24 hours after the fleet first reached the `v2:` layout -- not after this
process started -- on an unreferenced timer, never on the request path.** The first instance to
reach the store stamps `<keyPrefix>__layout__` with `{ version, firstSeenAt }`; every instance
reads it and sweeps only once it is older than the window, re-arming for the remainder until
then. The clock lives in the store because a process-local timer restarts on every deploy and
crash, so it never converges on "the fleet has been on `v2:` for a while". The marker is written
once and never overwritten, and if it cannot be read or parsed the purge stands down rather than
deleting on an unknown clock.

The window has to outlast the rollout _and_ the period in which a bad deploy is rolled back --
a rollback after the sweep makes the old fleet permanent again with its memory gone. Tune it
with `legacyPurgeDelayMs`, or pass `skipLegacyPurge: true` to migrate the data yourself. On
serverless and edge the invocation usually ends before the timer fires, so nothing is purged;
clear the legacy prefixes manually if you want the storage back.

### Tools Exposed (when `tools.enabled: true`)

- `remember_this` -- Store a key-value pair in memory
- `recall` -- Retrieve a previously stored value by key
- `forget` -- Remove a stored value by key
- `list_memories` -- List all stored keys, optionally filtered by pattern

---

## 3. Approval Plugin (`@frontmcp/plugin-approval`)

Tool authorization workflow with PKCE webhook security. Require explicit user or system approval before sensitive tools execute.

### Installation

```typescript
import { ApprovalPlugin } from '@frontmcp/plugin-approval';

// Recheck mode (default) -- re-evaluates approval on each call
@FrontMcp({
  plugins: [ApprovalPlugin.init()],
})
class BasicServer {}

// Recheck mode with explicit config
@FrontMcp({
  plugins: [
    ApprovalPlugin.init({
      mode: 'recheck',
      enableAudit: true,
    }),
  ],
})
class AuditedServer {}

// Webhook mode -- PKCE-secured external approval flow
@FrontMcp({
  plugins: [
    ApprovalPlugin.init({
      mode: 'webhook',
      webhook: {
        url: 'https://approval.example.com/webhook',
        challengeTtl: 300,
        callbackPath: '/approval/callback',
      },
      enableAudit: true,
      maxDelegationDepth: 3,
    }),
  ],
})
class WebhookServer {}
```

**`ApprovalPlugin.init()` registers the approval check itself.** Do not add `ApprovalCheckPlugin`
to `plugins`; listing it as well is harmless and the check still runs once per call. Require
1.8.1 or later: in 1.8.0 and earlier `ApprovalPlugin.init()` registered no check at all, so
tools marked `approval` ran unapproved.

### Modes

- `recheck` -- Re-evaluates approval status on every tool call. Approval can be granted programmatically via `this.approval.grantSessionApproval()`. Good for interactive approval flows where the user confirms in-band.
- `webhook` -- Sends a PKCE-secured webhook to an external approval service. The external service calls back to confirm or deny. Suitable for compliance workflows requiring out-of-band approval.

### Pre-approved contexts come from the session

`approval.preApprovedContexts` lists contexts that skip the approval check entirely. The
context a call runs in is taken **only** from `authInfo.extra.approvalContext`, which your
authentication layer sets while establishing the session.

A `context` field in the gated tool's own arguments is ignored. Do not build a flow that
expects the caller to declare its context -- the caller of a gated tool must not be able to
name the context that lets it skip the gate. Set the context when you authenticate:

```typescript
// In your auth layer, not in tool input
authInfo.extra.approvalContext = { type: 'project', identifier: resolvedProjectId };
```

### How the check decides

1. `skipApproval: true`, or approval not required: the tool runs.
2. A recorded **denial** for the caller (session or user scope): refused with state `denied`. A
   denial outranks pre-approved contexts and any session approval.
3. The session context is one of `preApprovedContexts`: the tool runs.
4. `alwaysPrompt: true`: refused with state `pending`.
5. A valid approval for the caller: the tool runs.
6. Otherwise refused with state `pending` (or `expired`).

A refused call throws `ApprovalRequiredError`; the client receives an error result.

Approvals are looked up by the tool's full name, `<owner id>:<tool name>`, so pass that name to
`this.approval` grant and check methods. The owner is the app that declares the tool, or the
adapter or plugin that provides it (`my-app:file_write` for a tool declared on app `my-app`,
`github-api:create_issue` for one its `github-api` adapter provides). Session approvals belong to a
session the server verified (`FrontMcpContext.verifiedSessionId`). A stateless request has none -- it
carries the shared stateless session id, or sends no `mcp-session-id` and runs under a fresh
per-request id -- so it is keyed by the authenticated principal (`authInfo.extra.userId`, then
`authInfo.extra.sub`, then `authInfo.clientId`): a grant made in one stateless request is found by
the same principal's next request and by no other principal. A stateless call with no principal
cannot hold a session approval. Releases up to 1.8.1 keyed a request without `mcp-session-id` by
its per-request id, so the grant was never found again
([#597](https://github.com/agentfront/frontmcp/issues/597)).

Installed on an app, `ApprovalPlugin` gates only that app's tools (including those its adapters
and plugins provide) against its own store, so two apps can each install it with separate stores.
Installed on the server, it gates every tool; a tool both gate must pass each store's check.
`this.approval` resolves the `ApprovalService` of the nearest `ApprovalPlugin` -- the one the
tool's own app installed, otherwise the server's -- so with two apps each installing it, a grant
or check in one app's tool uses that app's store. Releases up to 1.8.1 resolved the store of the
app registered last ([#600](https://github.com/agentfront/frontmcp/issues/600)).

### Using `this.approval` in Tools

```typescript
@Tool({ name: 'dangerous_action' })
class DangerousActionTool extends ToolContext {
  async execute(input: { target: string }) {
    // Check if tool is currently approved
    const isApproved = await this.approval.isApproved('dangerous_action');

    if (!isApproved) {
      // Grant session-scoped approval programmatically
      await this.approval.grantSessionApproval('dangerous_action', {
        reason: 'User confirmed via prompt',
      });
    }

    // Additional approval API methods:
    // await this.approval.getApproval('tool-id')          -- Get approval record
    // await this.approval.getSessionApprovals()            -- List session approvals
    // await this.approval.getUserApprovals()                -- List user approvals
    // await this.approval.grantUserApproval('tool-id')     -- Persist across sessions
    // await this.approval.grantTimeLimitedApproval('tool-id', 60000)  -- Auto-expire
    // await this.approval.revokeApproval('tool-id')        -- Revoke any approval

    return { content: [{ type: 'text', text: 'Action completed' }] };
  }
}
```

### Per-Tool Approval Metadata

```typescript
import { ApprovalScope } from '@frontmcp/plugin-approval';

@Tool({
  name: 'file_write',
  approval: {
    required: true,
    defaultScope: ApprovalScope.SESSION, // SESSION | USER | TIME_LIMITED | TOOL_SPECIFIC | CONTEXT_SPECIFIC
    category: 'write',
    riskLevel: 'medium', // 'low' | 'medium' | 'high' | 'critical'
    approvalMessage: 'Allow file writing for this session?',
  },
})
class FileWriteTool extends ToolContext {
  /* ... */
}
```

When `approval.required` is `true`, the plugin automatically intercepts tool execution and checks approval status before allowing the tool to run.

---

## 4. Cache Plugin (`@frontmcp/plugin-cache`)

Automatic tool result caching. Cache responses by tool name patterns or per-tool metadata. Supports sliding window TTL and cache bypass headers.

### Cache keys include the caller's identity

`keyByIdentity` defaults to `true`. Most cached tools return something that depends on who is
asking -- a profile, a balance, a tenant's records, anything filtered by the caller's own
permissions -- and a key built only from the tool and its arguments serves the first caller's
response to everyone else.

The identity is the subject your auth layer puts in `authInfo.extra` (`sub` / `userId`), then
the client id, then the session. For a request the SDK verified, the client id is the token's
`sub`, or `anon:<id>` for an anonymous session. Only a session the server verified
(`FrontMcpContext.verifiedSessionId`) is an identity: the session id the stateless HTTP transport
gives every request, the fresh per-request id of a request without `mcp-session-id`, and an
`mcp-session-id` the server did not accept are not. A call with no identity at all gets a key of
its own rather than one shared with every other identity-less caller.

Set `keyByIdentity: false` **only** when every caller would get byte-identical output: public
reference data, a currency table, a static document.

```typescript
// Public data, identical for everyone -- safe to share one entry
CachePlugin.init({ type: 'memory', toolPatterns: ['reference:*'], keyByIdentity: false });
```

### Installation

```typescript
import CachePlugin from '@frontmcp/plugin-cache';

// In-memory cache
@FrontMcp({
  plugins: [
    CachePlugin.init({
      type: 'memory',
      defaultTTL: 3600, // 1 hour in seconds
      toolPatterns: ['api:get-*', 'search:*'], // Cache tools matching glob patterns
      bypassHeader: 'x-frontmcp-disable-cache', // Header to skip cache
    }),
  ],
})
class CachedServer {}

// Redis cache
@FrontMcp({
  plugins: [
    CachePlugin.init({
      type: 'redis',
      config: { host: 'localhost', port: 6379 },
      defaultTTL: 86400, // 1 day in seconds
    }),
  ],
})
class RedisCachedServer {}

// Global store (uses @FrontMcp redis config)
@FrontMcp({
  redis: { host: 'localhost', port: 6379 },
  plugins: [CachePlugin.init({ type: 'global-store' })],
})
class GlobalCacheServer {}
```

### Storage Types

- `memory` -- In-process Map with automatic eviction. No external dependencies.
- `redis` -- Dedicated Redis connection with native TTL support. Plugin manages the client.
- `redis-client` -- Bring your own ioredis client instance.
- `global-store` -- Reuses the Redis connection from `@FrontMcp({ redis: {...} })`.

### Per-Tool Cache Metadata

Enable caching on individual tools via the `cache` metadata field:

```typescript
// Enable caching with default TTL
@Tool({ name: 'get_weather', cache: true })
class GetWeatherTool extends ToolContext {
  /* ... */
}

// Custom TTL and sliding window
@Tool({
  name: 'get_user_profile',
  cache: {
    ttl: 3600, // Override default TTL (seconds)
    slideWindow: true, // Refresh TTL on cache hit
  },
})
class GetUserProfileTool extends ToolContext {
  /* ... */
}
```

### Tool Patterns

Use glob patterns to cache groups of tools without modifying each tool:

```typescript
CachePlugin.init({
  type: 'memory',
  defaultTTL: 3600,
  toolPatterns: [
    'namespace:*', // All tools in a namespace
    'api:get-*', // All GET-like API tools
    'search:*', // All search tools
  ],
});
```

A tool is cached if it matches any pattern OR has `cache: true` (or a cache object) in its metadata.

### Cache Bypass

Send the bypass header to skip caching for a specific request:

```text
x-frontmcp-disable-cache: true
```

The header name is configurable via `bypassHeader` in the plugin options. Default: `'x-frontmcp-disable-cache'`.

### Cache Key

The cache key is a SHA-256 digest of the tool name, the serialized input arguments, and -- by default -- the caller's
identity. Two calls share an entry only when all three match.

Set `keyByIdentity: false` to drop identity from the key, and only for output that is identical for every caller. See
"Cache keys include the caller's identity" above.

---

## 5. Feature Flags Plugin (`@frontmcp/plugin-feature-flags`)

Gate tools, resources, prompts, and skills behind feature flags. Integrates with popular feature flag services or static configuration.

### A flag withholds the capability, it does not just hide it

A disabled flag filters the entry out of `tools/list`, `resources/list`, `prompts/list` and
`skills/search`, **and** refuses it on direct access: `tools/call`, `resources/read` and
`prompts/get` each evaluate the flag before executing.

That matters because a listing is not an access control. Clients cache listings and hold
resource URIs and prompt names from earlier sessions, so anything gated only at list time
stays reachable by name. If the adapter is unavailable the gate uses the ref's
`defaultValue`, and a bare string ref (no default) fails closed.

### Installation

```typescript
import FeatureFlagPlugin from '@frontmcp/plugin-feature-flags';

// Static flags (no external dependency)
@FrontMcp({
  plugins: [
    FeatureFlagPlugin.init({
      adapter: 'static',
      flags: {
        'beta-tools': true,
        'experimental-agent': false,
        'new-search': true,
      },
    }),
  ],
})
class StaticFlagServer {}

// Split.io
@FrontMcp({
  plugins: [
    FeatureFlagPlugin.init({
      adapter: 'splitio',
      config: { apiKey: 'sdk-key-xxx' },
    }),
  ],
})
class SplitServer {}

// LaunchDarkly
@FrontMcp({
  plugins: [
    FeatureFlagPlugin.init({
      adapter: 'launchdarkly',
      config: { sdkKey: 'sdk-xxx' },
    }),
  ],
})
class LDServer {}

// Unleash
@FrontMcp({
  plugins: [
    FeatureFlagPlugin.init({
      adapter: 'unleash',
      config: {
        url: 'https://unleash.example.com/api',
        appName: 'my-mcp-server',
        apiKey: 'xxx',
      },
    }),
  ],
})
class UnleashServer {}

// Custom adapter
@FrontMcp({
  plugins: [
    FeatureFlagPlugin.init({
      adapter: 'custom',
      adapterInstance: myCustomAdapter,
    }),
  ],
})
class CustomFlagServer {}
```

### Adapters

- `static` -- Hardcoded flag map. No external service. Good for development and testing.
- `splitio` -- Split.io integration. Requires `@splitsoftware/splitio` package.
- `launchdarkly` -- LaunchDarkly integration. Requires `launchdarkly-node-server-sdk` package.
- `unleash` -- Unleash integration. Requires `unleash-client` package.
- `custom` -- Provide your own adapter instance implementing the `FeatureFlagAdapter` interface.

### Using `this.featureFlags` in Tools

```typescript
@Tool({ name: 'beta_feature' })
class BetaFeatureTool extends ToolContext {
  async execute(input: unknown) {
    // Check if a flag is enabled (returns boolean)
    const enabled = await this.featureFlags.isEnabled('beta-feature-flag');
    if (!enabled) {
      return { content: [{ type: 'text', text: 'Feature not available' }] };
    }

    // Get variant value (for multivariate flags)
    const variant = await this.featureFlags.getVariant('experiment-flag');
    // variant may be 'control', 'treatment-a', 'treatment-b', etc.

    return { content: [{ type: 'text', text: `Running variant: ${variant}` }] };
  }
}
```

### Per-Tool Feature Flag Gating

Tools gated by a feature flag are automatically hidden from `list_tools` and blocked from execution when the flag is off:

```typescript
// Simple string key -- flag must be truthy to enable the tool
@Tool({ name: 'beta_tool', featureFlag: 'enable-beta-tools' })
class BetaTool extends ToolContext {
  /* ... */
}

// Object with default value -- if flag evaluation fails, use the default
@Tool({
  name: 'experimental_tool',
  featureFlag: { key: 'experimental-flag', defaultValue: false },
})
class ExperimentalTool extends ToolContext {
  /* ... */
}
```

The plugin hooks into listing and execution flows for tools, resources, resource templates, prompts, and skills. When a flag evaluates to `false`, the corresponding entry is filtered from list results and direct access is refused:

| Capability        | Hidden from                                                                                                                                                                                                    | Refused on                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Tool              | `tools/list`, and the `toolName` completion of `ui://widget/{toolName}.html`                                                                                                                                   | `tools/call`                                                                                                    |
| Resource          | `resources/list`                                                                                                                                                                                               | `resources/read`, `completion/complete`                                                                         |
| Resource template | `resources/templates/list`                                                                                                                                                                                     | `resources/read` of any URI it matches, `completion/complete`                                                   |
| Prompt            | `prompts/list`                                                                                                                                                                                                 | `prompts/get`, `completion/complete`                                                                            |
| Skill             | `skills/search`, `skills/list`, `skill://index.json`, its `skill://<path>/SKILL.md` entry in `resources/list`, `GET /skills`, `/llm.txt`, `/llm_full.txt`, `codecall:searchSkills`, `codecall:searchKnowledge` | `skills/load`, `skill://<path>/SKILL.md` and its files, `GET /skills/{id}` (same answer as a nonexistent skill) |

The `toolName` completion of `ui://widget/{toolName}.html` runs the caller's `tools:list-tools` flow, so it offers only the UI tools `tools/list` shows that caller -- a flagged-off tool is left out there too ([#596](https://github.com/agentfront/frontmcp/issues/596)).

The skill catalog in the `initialize` instructions (and the SEP-2640 `skill://` hints under `skillsConfig.sep2640InInstructions`) is filtered for the initializing client too, so a flag-disabled skill's name and description never appear there ([#603](https://github.com/agentfront/frontmcp/issues/603)). A skill's `skill://<path>/SKILL.md` entry in `resources/list` is gated by the skill that path serves now -- replace a skill at the same path and the entry takes the new skill's flag ([#606](https://github.com/agentfront/frontmcp/issues/606)).

Installed on an `@App`, the gates cover every capability that app provides, including tools, resources and prompts contributed by its adapters (e.g. an OpenAPI adapter) and plugins. Its tool, resource, prompt and completion gates do not run for other apps' capabilities -- install it in `@FrontMcp({ plugins })` to gate every app. Resources and prompts served outside every app (the SEP-2640 `skill://` resources) are gated by every installed copy. Skills are gated through the `skills:filter` flow, which every skill surface runs -- as the calling user on every transport, stdio and in-memory included; custom plugins can hook `Did('filterSkills')` on it the same way, and reuse `filterServableSkills(scope, skills)` from `@frontmcp/sdk` to serve skills from a surface of their own.

---

## 6. Dashboard Plugin (`@frontmcp/plugin-dashboard`) — BETA

> **Warning:** The Dashboard plugin is currently in **beta** and may not work correctly. It is not recommended for production use. Expect breaking changes and missing features.

Visual monitoring web UI for your FrontMCP server. View server structure (tools, resources, prompts, apps, plugins) as an interactive graph.

### Installation

```typescript
import DashboardPlugin from '@frontmcp/plugin-dashboard';

// Basic (auto-enabled in dev, disabled in production)
@FrontMcp({
  plugins: [DashboardPlugin.init({})],
})
class DevServer {}

// With authentication and custom CDN
@FrontMcp({
  plugins: [
    DashboardPlugin.init({
      enabled: true,
      basePath: '/dashboard',
      auth: {
        enabled: true,
        token: 'my-secret-token',
      },
      cdn: {
        entrypoint: 'https://cdn.example.com/dashboard-ui@1.0.0/index.js',
      },
    }),
  ],
})
class ProdServer {}
// Access: http://localhost:3000/dashboard?token=my-secret-token
```

### Options

```typescript
interface DashboardPluginOptionsInput {
  enabled?: boolean; // Auto: enabled in dev, disabled in prod
  basePath?: string; // Default: '/dashboard'
  auth?: {
    enabled?: boolean; // Default: false
    token?: string; // Query param auth (?token=xxx)
  };
  cdn?: {
    entrypoint?: string; // Custom UI bundle URL
    react?: string; // React CDN URL override
    reactDom?: string; // React DOM CDN URL override
    xyflow?: string; // XYFlow (React Flow) CDN URL override
    dagre?: string; // Dagre layout CDN URL override
  };
}
```

- `enabled` -- When omitted, the dashboard is automatically enabled in development (`NODE_ENV !== 'production'`) and disabled in production.
- `basePath` -- URL path where the dashboard is served. Default: `'/dashboard'`.
- `auth.enabled` / `auth.token` -- Gate the dashboard page on a shared secret. Present it as `Authorization: Bearer <token>` (preferred) or `?token=<value>`. `enabled: true` without a `token` is a **startup error** — the server refuses to boot rather than serve an "authenticated" dashboard with nothing to check. The token is compared in constant time and is never embedded in the served page.
- `cdn` -- Override default CDN URLs for the dashboard UI bundle and its dependencies. Useful for air-gapped environments.

### Security

**Requires 1.7.2 or later.** Before 1.7.2 (GHSA-rgxj-434m-vxh3) `auth.token` was documented and validated but never checked, the operator's options never reached the middleware at all, and the dashboard's MCP scope declared `auth: { mode: 'public' }` unconditionally — so a dashboard configured with a secret still served its page, and `dashboard:graph` still returned the entire server's inventory, to anyone. On 1.7.1 or earlier, treat any server running `DashboardApp` as publicly introspectable.

The dashboard's MCP scope **inherits the server's authentication**. Its introspection tools (`dashboard:graph`, `dashboard:list-tools`, `dashboard:list-resources`) reach the root scope and enumerate every app, tool, resource and prompt on the server — including names, descriptions and (on request) schemas. Two consequences:

- On an authenticated server (`local`, `remote`, `transparent`, `orchestrated`), the dashboard requires the same credential as everything else.
- On a **public** server the dashboard is public too, because the server is. `auth.token` gates the dashboard _page_, not the MCP scope or the SSE stream. If the inventory is sensitive, authenticate the server — do not rely on the dashboard token alone.

Three further limitations worth knowing:

- **The bundled page cannot authenticate itself against a non-public server.** The browser client opens `EventSource(sseUrl)` and POSTs with no `Authorization` header, and the SDK reads the credential from that header only. So on a server with `local`/`remote`/`transparent`/`orchestrated` auth the page loads (its own token gates that) but the in-page graph, tool list and SSE stream get `401`. Run the dashboard on a public/development server, or put it behind a proxy that injects a credential — scoped to the dashboard's own routes (`<basePath>/sse` and `<basePath>/message`) and holding no grant beyond the dashboard scope, since injecting a server credential across the MCP endpoint would let any page on that origin issue arbitrary authenticated JSON-RPC. Failing closed here is deliberate — the alternative is the `mode: 'public'` scope that GHSA-rgxj-434m-vxh3 was about.
- The token is accepted as `Authorization: Bearer <token>` (scheme matched case-insensitively) or `?token=`. Prefer the header: a URL token lands in browser history, `Referer` headers and access logs. There is no cookie/session option yet.
- Dashboard options are **process-wide**. Two `@FrontMcp` servers built in one process that configure the dashboard with CONFLICTING auth now throw at registration rather than silently sharing the last token; a differing `basePath` or `cdn` logs a warning. Run one dashboard per process, or call `resetDashboardOptions()` between serial constructions.

---

## Registration Pattern

All official plugins use the static `init()` pattern inherited from `DynamicPlugin`. Register them in the `plugins` array of your `@FrontMcp` decorator:

```typescript
@FrontMcp({
  info: { name: 'production-server', version: '1.0.0' },
  apps: [MyApp],
  plugins: [
    CodeCallPlugin.init({ mode: 'codecall_only', vm: { preset: 'secure' } }),
    RememberPlugin.init({ type: 'redis', config: { host: 'redis.internal' } }),
    ApprovalPlugin.init({ mode: 'recheck' }),
    CachePlugin.init({ type: 'redis', config: { host: 'redis.internal' }, defaultTTL: 86400 }),
    FeatureFlagPlugin.init({ adapter: 'launchdarkly', config: { sdkKey: 'sdk-xxx' } }),
    // DashboardPlugin.init({ enabled: true, auth: { ... } }), // Beta — not recommended for production
  ],
  tools: [
    /* ... */
  ],
})
class ProductionServer {}
```

## Common Patterns

| Pattern                  | Correct                                                            | Incorrect                                                                       | Why                                                                                                      |
| ------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Plugin registration      | `plugins: [RememberPlugin.init({ type: 'memory' })]`               | `plugins: [new RememberPlugin({ type: 'memory' })]`                             | Official plugins use `DynamicPlugin.init()` static method; direct instantiation bypasses provider wiring |
| Remember storage in prod | `RememberPlugin.init({ type: 'redis', config: { host: '...' } })`  | `RememberPlugin.init({ type: 'memory' })` in production                         | Memory storage loses data on restart; use Redis or Vercel KV for persistence                             |
| Cache TTL units          | `defaultTTL: 3600` (seconds)                                       | `defaultTTL: 3600000` (milliseconds)                                            | Cache TTL is in seconds, not milliseconds; 3600000 = 41 days                                             |
| Feature flag gating      | `@Tool({ featureFlag: 'my-flag' })` on the tool decorator          | Checking `this.featureFlags.isEnabled()` inside `execute()` and returning early | Decorator-level gating hides the tool from `list_tools`; manual check still exposes it                   |
| Dashboard (beta)         | Avoid in production — plugin is in beta and may not work correctly | `DashboardPlugin.init({})` in production                                        | Dashboard plugin is unstable; use only for local development experimentation                             |

## Verification Checklist

### Installation

- [ ] Plugin package is installed (`@frontmcp/plugin-codecall`, `@frontmcp/plugin-remember`, etc.)
- [ ] Plugin is registered via `.init()` in the `plugins` array of `@FrontMcp`
- [ ] Required configuration options are provided (storage type, API keys, endpoints)

### Runtime

- [ ] `this.remember` / `this.approval` / `this.featureFlags` resolves in tool context
- [ ] Cache plugin returns cached results on repeated identical calls
- [ ] Feature-flagged tools are hidden from `list_tools` when flag is off
- [ ] Dashboard is accessible at configured `basePath` (default: `/dashboard`) — beta, may not work
- [ ] Approval plugin blocks unapproved tools and grants approval correctly

### Production

- [ ] Redis or external storage is configured for Remember and Cache plugins
- [ ] Dashboard authentication is enabled with a secret token (if using beta Dashboard plugin)
- [ ] Feature flag adapter connects to external service (not `'static'`)

## Troubleshooting

| Problem                           | Cause                                                                            | Solution                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `this.remember` is undefined      | RememberPlugin not registered or missing `.init()`                               | Add `RememberPlugin.init({ type: 'memory' })` to `plugins` array                     |
| Cache not working for a tool      | Tool name does not match any `toolPatterns` glob and `cache` metadata is not set | Add `cache: true` to `@Tool` decorator or add matching pattern to `toolPatterns`     |
| Feature flag always returns false | Using `'static'` adapter with flag not in the `flags` map                        | Add the flag key to `flags: { 'my-flag': true }` or check adapter connection         |
| Dashboard returns 404             | Plugin is in beta and auto-disabled in production (`NODE_ENV=production`)        | Dashboard is unstable — avoid in production. For dev: set `enabled: true` explicitly |
| Approval webhook times out        | Callback URL not reachable from the external approval service                    | Verify `callbackPath` is publicly accessible and matches the webhook configuration   |

## Examples

| Example                                                                                            | Level        | Description                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`cache-and-feature-flags`](../examples/official-plugins/cache-and-feature-flags.md)               | Intermediate | Demonstrates combining the Cache plugin for tool result caching with the Feature Flags plugin for gating tools behind flags.                                                 |
| [`production-multi-plugin-setup`](../examples/official-plugins/production-multi-plugin-setup.md)   | Advanced     | Demonstrates a production-ready server configuration combining CodeCall, Remember, Approval, Cache, and Feature Flags plugins with Redis storage and external flag services. |
| [`remember-plugin-session-memory`](../examples/official-plugins/remember-plugin-session-memory.md) | Basic        | Demonstrates installing the Remember plugin and using `this.remember` in tools to store and retrieve session memory.                                                         |

> See all examples in [`examples/official-plugins/`](../examples/official-plugins/)

## Reference

- [Plugins Overview Documentation](https://docs.agentfront.dev/frontmcp/plugins/overview)
- Related skills: `create-plugin`, `create-plugin-hooks`, `create-tool`
