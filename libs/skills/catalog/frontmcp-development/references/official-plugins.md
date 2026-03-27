# Official FrontMCP Plugins

FrontMCP ships 6 official plugins that extend server behavior with cross-cutting concerns: semantic tool discovery, session memory, authorization workflows, result caching, feature gating, and visual monitoring. Install individually or via `@frontmcp/plugins` (meta-package re-exporting cache, codecall, dashboard, and remember).

## When to Use This Skill

### Must Use

- Installing and configuring any official FrontMCP plugin (CodeCall, Remember, Approval, Cache, Feature Flags, Dashboard)
- Adding session memory, tool caching, or authorization workflows to an existing server
- Integrating feature flag services (LaunchDarkly, Split.io, Unleash) to gate tools at runtime

### Recommended

- Setting up the Dashboard plugin for visual monitoring of server structure in development
- Configuring CodeCall for semantic tool discovery when the server has many tools
- Combining multiple official plugins in a production deployment

### Skip When

- You need to build a custom plugin with your own providers and context extensions (see `create-plugin`)
- You only need lifecycle hooks without installing an official plugin (see `create-plugin-hooks`)
- You need to generate tools from an OpenAPI spec (see `official-adapters`)

> **Decision:** Use this skill when you need to install, configure, or customize one or more of the 6 official FrontMCP plugins.

All plugins follow the `DynamicPlugin` pattern and are registered via `@FrontMcp({ plugins: [...] })`.

```typescript
import { FrontMcp } from '@frontmcp/sdk';
import CodeCallPlugin from '@frontmcp/plugin-codecall';
import RememberPlugin from '@frontmcp/plugin-remember';
import { ApprovalPlugin } from '@frontmcp/plugin-approval';
import CachePlugin from '@frontmcp/plugin-cache';
import FeatureFlagPlugin from '@frontmcp/plugin-feature-flags';
import DashboardPlugin from '@frontmcp/plugin-dashboard';

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
    DashboardPlugin.init({ enabled: true }),
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

- `codecall_only` -- Hides all tools from `list_tools` except CodeCall meta-tools. All other tools are discovered only via `codecall:search`. Best when the server has a large number of tools and you want the AI to search-then-execute.
- `codecall_opt_in` -- Shows all tools in `list_tools` normally. Tools opt-in to CodeCall execution via metadata. Useful when only some tools benefit from orchestrated execution.
- `metadata_driven` -- Per-tool `metadata.codecall` controls visibility and CodeCall availability independently. Most granular control.

### VM Presets

The sandboxed VM runs AgentScript (a restricted JavaScript subset). Presets control security boundaries:

- `locked_down` -- Most restrictive. No loops, no console, minimal builtins. Suitable for untrusted environments.
- `secure` -- Default. Reasonable limits for production use. Loops disabled, console available.
- `balanced` -- Relaxed constraints for development. Loops allowed with iteration limits.
- `experimental` -- Minimal restrictions. Full loop support, extended builtins. Development only.

### Meta-Tools Exposed

CodeCall contributes 4 tools to your server:

- `codecall:search` -- Semantic search over all registered tools using TF-IDF scoring with synonym expansion. Returns ranked tool names, descriptions, and relevance scores.
- `codecall:describe` -- Returns full input/output JSON schemas for one or more tools. Use after search to understand tool interfaces before execution.
- `codecall:execute` -- Runs an AgentScript program in the sandboxed VM. The script can call multiple tools, branch on results, and compose outputs.
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

### Modes

- `recheck` -- Re-evaluates approval status on every tool call. Approval can be granted programmatically via `this.approval.grantSessionApproval()`. Good for interactive approval flows where the user confirms in-band.
- `webhook` -- Sends a PKCE-secured webhook to an external approval service. The external service calls back to confirm or deny. Suitable for compliance workflows requiring out-of-band approval.

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
@Tool({
  name: 'file_write',
  approval: {
    required: true,
    defaultScope: 'session', // 'session' | 'user' | 'time-limited'
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

The cache key is computed from the tool name and the serialized input arguments. Two calls with identical tool name and arguments return the same cached result.

---

## 5. Feature Flags Plugin (`@frontmcp/plugin-feature-flags`)

Gate tools, resources, prompts, and skills behind feature flags. Integrates with popular feature flag services or static configuration.

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

The plugin hooks into listing and execution flows for tools, resources, prompts, and skills. When a flag evaluates to `false`, the corresponding entry is filtered from list results and direct invocation returns an error.

---

## 6. Dashboard Plugin (`@frontmcp/plugin-dashboard`)

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
- `auth.token` -- When set, the dashboard requires `?token=<value>` as a query parameter.
- `cdn` -- Override default CDN URLs for the dashboard UI bundle and its dependencies. Useful for air-gapped environments.

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
    DashboardPlugin.init({ enabled: true, auth: { enabled: true, token: process.env.DASH_TOKEN } }),
  ],
  tools: [
    /* ... */
  ],
})
class ProductionServer {}
```

## Common Patterns

| Pattern                  | Correct                                                                          | Incorrect                                                                       | Why                                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Plugin registration      | `plugins: [RememberPlugin.init({ type: 'memory' })]`                             | `plugins: [new RememberPlugin({ type: 'memory' })]`                             | Official plugins use `DynamicPlugin.init()` static method; direct instantiation bypasses provider wiring |
| Remember storage in prod | `RememberPlugin.init({ type: 'redis', config: { host: '...' } })`                | `RememberPlugin.init({ type: 'memory' })` in production                         | Memory storage loses data on restart; use Redis or Vercel KV for persistence                             |
| Cache TTL units          | `defaultTTL: 3600` (seconds)                                                     | `defaultTTL: 3600000` (milliseconds)                                            | Cache TTL is in seconds, not milliseconds; 3600000 = 41 days                                             |
| Feature flag gating      | `@Tool({ featureFlag: 'my-flag' })` on the tool decorator                        | Checking `this.featureFlags.isEnabled()` inside `execute()` and returning early | Decorator-level gating hides the tool from `list_tools`; manual check still exposes it                   |
| Dashboard in production  | `DashboardPlugin.init({ enabled: true, auth: { enabled: true, token: '...' } })` | `DashboardPlugin.init({})` without auth in production                           | Dashboard auto-disables in production; if enabled, always set auth token                                 |

## Verification Checklist

### Installation

- [ ] Plugin package is installed (`@frontmcp/plugin-codecall`, `@frontmcp/plugin-remember`, etc.)
- [ ] Plugin is registered via `.init()` in the `plugins` array of `@FrontMcp`
- [ ] Required configuration options are provided (storage type, API keys, endpoints)

### Runtime

- [ ] `this.remember` / `this.approval` / `this.featureFlags` resolves in tool context
- [ ] Cache plugin returns cached results on repeated identical calls
- [ ] Feature-flagged tools are hidden from `tools/list` when flag is off
- [ ] Dashboard is accessible at configured `basePath` (default: `/dashboard`)
- [ ] Approval plugin blocks unapproved tools and grants approval correctly

### Production

- [ ] Redis or external storage is configured for Remember and Cache plugins
- [ ] Dashboard authentication is enabled with a secret token
- [ ] Feature flag adapter connects to external service (not `'static'`)

## Troubleshooting

| Problem                           | Cause                                                                            | Solution                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `this.remember` is undefined      | RememberPlugin not registered or missing `.init()`                               | Add `RememberPlugin.init({ type: 'memory' })` to `plugins` array                   |
| Cache not working for a tool      | Tool name does not match any `toolPatterns` glob and `cache` metadata is not set | Add `cache: true` to `@Tool` decorator or add matching pattern to `toolPatterns`   |
| Feature flag always returns false | Using `'static'` adapter with flag not in the `flags` map                        | Add the flag key to `flags: { 'my-flag': true }` or check adapter connection       |
| Dashboard returns 404             | Plugin auto-disabled in production (`NODE_ENV=production`)                       | Set `enabled: true` explicitly in `DashboardPlugin.init()` options                 |
| Approval webhook times out        | Callback URL not reachable from the external approval service                    | Verify `callbackPath` is publicly accessible and matches the webhook configuration |

## Reference

- [Plugins Overview Documentation](https://docs.agentfront.dev/frontmcp/plugins/overview)
- Related skills: `create-plugin`, `create-plugin-hooks`, `create-tool`
