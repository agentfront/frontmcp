import { guardConfigSchema, type GuardConfig } from '@frontmcp/guard';
import { internalZ as z } from '@frontmcp/lazy-zod';

import type { ServerManifest } from '../../manifest/server-manifest.schema';
import { MAX_CONCURRENT_TASKS_PER_SESSION } from '../../task/task.types';
import type { AdapterType, AppType, PluginType, ProviderType, ResourceType, SkillType, ToolType } from '../interfaces';
import {
  annotatedFrontMcpAdaptersSchema,
  annotatedFrontMcpAppSchema,
  annotatedFrontMcpPluginsSchema,
  annotatedFrontMcpProvidersSchema,
  annotatedFrontMcpResourcesSchema,
  annotatedFrontMcpSkillsSchema,
  annotatedFrontMcpToolsSchema,
} from '../schemas';
import {
  authOptionsSchema,
  clientProfilesOptionsSchema,
  devtoolsOptionsSchema,
  elicitationOptionsSchema,
  extAppsOptionsSchema,
  healthOptionsSchema,
  httpOptionsSchema,
  instructionsBudgetOptionsSchema,
  lifecycleOptionsSchema,
  loggingOptionsSchema,
  mcpRegistryOptionsSchema,
  metricsOptionsSchema,
  observabilityOptionsSchema,
  offloadOptionsSchema,
  outboundFetchOptionsSchema,
  paginationOptionsSchema,
  pubsubOptionsSchema,
  redisOptionsSchema,
  serverInfoOptionsSchema,
  skillsConfigOptionsSchema,
  sqliteOptionsSchema,
  transportOptionsSchema,
  type AuthOptions,
  type AuthOptionsInput,
  type ClientProfilesOptionsInput,
  type DevtoolsOptionsInput,
  type ElicitationOptionsInput,
  type ExtAppsOptionsInput,
  type HealthOptionsInput,
  type HttpOptionsInput,
  type InstructionsBudgetOptionsInput,
  type LifecycleOptionsInput,
  type LoggingOptionsInput,
  type McpRegistryOptionsInput,
  type MetricsOptionsInput,
  type ObservabilityOptionsInterface,
  type OffloadOptionsInput,
  type OutboundFetchOptionsInput,
  type PaginationOptions,
  type PubsubOptionsInput,
  type RawZodShape,
  type RedisOptionsInput,
  type ServerInfoOptions,
  type SessionOptionsInterface,
  type SkillsConfigOptionsInput,
  type SqliteOptionsInput,
  type TransportOptionsInput,
} from '../types';
import { legacySessionOptionsSchema } from '../types/options/session/schema';
import { packageLoaderSchema, type PackageLoader } from './app.metadata';
import { channelsConfigSchema, type ChannelsConfigInput } from './channel.metadata';
import { MAX_JOB_TIMER_MS, timerLimitMessage } from './job.metadata';
import { outputPolicySchema, type OutputPolicy } from './output-policy';
import type { WidgetServingMode } from './tool-ui.metadata';
import { widgetServingModeSchema } from './ui-serving-mode';

export interface FrontMcpBaseMetadata {
  info: ServerInfoOptions;
  apps: AppType[];
  http?: HttpOptionsInput;
  logging?: LoggingOptionsInput;

  serve?: boolean; // default to true

  /**
   * Directory of the source file that declared this `@FrontMcp` class, captured
   * automatically at decoration time (no `fileURLToPath` needed). Anchors
   * relative file paths in the server config — notably `auth.ui[slot]` for the
   * multi-app scope. `undefined` when the call-site couldn't be determined (the
   * registry then falls back to `process.cwd()`). Internal; do not set manually.
   *
   * @internal
   */
  __sourceDir?: string;

  /**
   * Server-level instructions surfaced through the MCP `initialize` response.
   *
   * The MCP `InitializeResult.instructions` field lets the server hand the
   * client a "system prompt" describing how to use available capabilities.
   * FrontMCP merges this string with channel hints and (optionally) bundle
   * skill instructions per `skillsConfig.injectInstructions`.
   *
   * Keep this short — clients typically include it verbatim in the model
   * context window. The full skill catalog is exposed via the SEP-2640
   * `skill://index.json` resource and `skill://{skillPath}/SKILL.md`
   * resources, or the `skills/search` and `skills/load` MCP extension
   * methods when `skillsConfig.mcpResources` is false.
   *
   * @see `skillsConfig.injectInstructions` for the merge policy. Note that
   *   `'replace'` falls back to `'append'` semantics when `instructions` is
   *   empty/undefined so a misconfigured server doesn't silently drop the
   *   catalog and channel hints.
   */
  instructions?: string;

  /**
   * Size limits, in characters, for the `initialize` instructions and each tool's `description`. Some clients copy
   * the instructions into every tool's description. Over a limit, the server logs a warning at startup and
   * `frontmcp build` reports it in its manifest lint (an error with `--strict-lint`). `false` turns both off.
   *
   * @default { instructions: 1024, toolDescription: 1024 }
   */
  instructionsBudget?: InstructionsBudgetOptionsInput;

  /**
   * The `frontmcp.manifest.json` the server's lazy apps (`apps: [{ name, lazy }]`) are listed from until their first
   * call: its path, or the manifest itself (a Worker or browser build imports it). By default the server reads the
   * one next to its entry script, where `frontmcp build` writes it.
   */
  manifest?: string | ServerManifest;

  /**
   * Shared storage configuration
   * Used by transport persistence and auth token storage.
   * Supports both Redis and Vercel KV providers.
   */
  redis?: RedisOptionsInput;

  /**
   * Pub/Sub configuration (Redis-only)
   * Required for resource subscriptions when using Vercel KV for sessions.
   * Falls back to `redis` config if not specified and redis is configured with Redis provider.
   */
  pubsub?: PubsubOptionsInput;

  /**
   * Transport and session lifecycle configuration
   * Controls transport protocols, session management, and persistence
   * @default {} (all transport options use their schema defaults)
   */
  transport?: TransportOptionsInput; // Optional in input, but always defined in output

  /**
   * The pre-1.0 session options, replaced by `transport` in v1.0.
   *
   * @deprecated Ignored: sessions follow `transport.protocol` (`'stateless-api'` serves without
   * them) and platform detection is `transport.platformDetection`. Accepted only so a config that
   * still sets it gets a startup warning instead of losing it silently. Removed in the next major.
   */
  session?: SessionOptionsInterface;

  /**
   * Additional providers that are available to all apps.
   */
  providers?: ProviderType[];

  /**
   * Provider lifecycle settings: how long each provider's `onShutdown()` may run.
   * @default { shutdownHookTimeoutMs: 3000 }
   */
  lifecycle?: LifecycleOptionsInput;

  /**
   * The worker-thread pool that runs `this.offload()` calls and the reads of `worker: true` resources (Node only).
   * @default { budgetMs: 30000, idleTimeoutMs: 30000, env: ['NODE_ENV'] }
   */
  offload?: OffloadOptionsInput;

  /**
   * Development aids: `hookTrace` adds the hooks a call ran to its answer's `_meta['frontmcp/trace']` (it adds no key
   * when no hook ran).
   * @default { hookTrace: true } when NODE_ENV is 'development', {} otherwise
   */
  devtools?: DevtoolsOptionsInput;

  /**
   * Shared tools that are available to all apps, in every scope (each `splitByApp` or standalone app's too).
   * These are merged (additively) with app-specific tools; one named like an app's tool is listed as `server:<name>`.
   */
  tools?: ToolType[];

  /**
   * Shared resources and resource templates that are available to all apps, in every scope.
   * These are merged (additively) with app-specific resources.
   */
  resources?: ResourceType[];

  /**
   * Shared skills that are available to all apps.
   * These are merged (additively) with app-specific skills.
   */
  skills?: SkillType[];

  /**
   * Server-level plugins that are instantiated per scope.
   * Each scope gets its own instance of these plugins.
   * These plugins have server-wide access (can see all apps in scope).
   */
  plugins?: PluginType[];

  /**
   * Server-level adapters (e.g. `OpenapiAdapter.init({ ... })`). The tools, resources and prompts each
   * adapter fetches are served by every app, like the entries of a server-level plugin. Each scope (a
   * standalone or `splitByApp` app gets its own) builds its own adapter from an `init()` record and runs
   * its `fetch()`; a hand-written `{ provide, useValue }` record is one adapter that every scope shares.
   */
  adapters?: AdapterType[];

  /**
   * Pagination configuration for list operations.
   * Currently only tool list pagination is supported (tools/list endpoint).
   */
  pagination?: PaginationOptions;

  /**
   * What `this.fetch()` adds to upstream requests. By default neither the caller's
   * access token nor its `x-frontmcp-*` headers leave this server.
   */
  fetch?: OutboundFetchOptionsInput;

  /**
   * Elicitation configuration.
   * Controls whether tools can request interactive user input during execution.
   * When enabled, tool output schemas are extended to include elicitation fallback response type.
   * @default { enabled: false }
   */
  elicitation?: ElicitationOptionsInput;

  /**
   * Skills HTTP endpoints configuration.
   * Controls exposure of skills via HTTP endpoints for multi-agent architectures.
   *
   * When enabled, provides:
   * - GET /llm.txt - Compact skill summaries
   * - GET /llm_full.txt - Full skills with instructions and tool schemas
   * - GET /skills - JSON API for listing/searching skills
   * - GET /skills/{id} - Load specific skill by ID
   *
   * @default { enabled: false }
   *
   * @example Enable skills HTTP endpoints
   * ```typescript
   * skillsConfig: { enabled: true }
   * ```
   *
   * @example HTTP-only (disable MCP resources)
   * ```typescript
   * skillsConfig: {
   *   enabled: true,
   *   mcpResources: false,  // No skill:// MCP resources
   * }
   * ```
   */
  skillsConfig?: SkillsConfigOptionsInput;

  /**
   * MCP Apps (ext-apps) configuration.
   * Controls handling of ext-apps widget-to-host communication over HTTP transport.
   *
   * When enabled, the HTTP transport will route the `ui/*` JSON-RPC methods
   * a widget sends (ui/initialize, ui/open-link, etc.) and its
   * `notifications/message` through session validation and the
   * ExtAppsMessageHandler. A widget calls a tool with the standard
   * `tools/call`, which runs as any MCP request. The earlier names
   * ui/callServerTool, ui/openLink, ui/setDisplayMode, ui/updateModelContext,
   * ui/log and ui/close are still accepted.
   *
   * ## Host Capabilities
   *
   * Host capabilities advertise what features the server supports to widgets:
   *
   * | Capability           | Description                                      | Default |
   * |---------------------|--------------------------------------------------|---------|
   * | `serverToolProxy`   | Allow widgets to call MCP tools via the earlier ui/callServerTool | `true`  |
   * | `logging`           | Allow widgets to send logs via notifications/message (or ui/log) | `true`  |
   * | `openLink`          | Allow widgets to request URL opening via ui/open-link (or ui/openLink) | `false` |
   * | `modelContextUpdate`| Allow widgets to update model context via ui/update-model-context (or ui/updateModelContext) | `false` |
   * | `widgetTools`       | Allow widgets to register/unregister tools dynamically (ui/registerTool, ui/unregisterTool: FrontMCP extensions) | `false` |
   * | `displayModes`      | Display modes ui/request-display-mode may ask for: 'inline', 'fullscreen', 'pip' | `undefined` |
   *
   * @default { enabled: true, hostCapabilities: { serverToolProxy: true, logging: true } }
   *
   * @example Enable ext-apps with default capabilities
   * ```typescript
   * extApps: { enabled: true }
   * ```
   *
   * @example Configure all host capabilities
   * ```typescript
   * extApps: {
   *   enabled: true,
   *   hostCapabilities: {
   *     serverToolProxy: true,    // Widgets can call MCP tools
   *     logging: true,            // Widgets can send logs
   *     openLink: true,           // Widgets can request URL opening
   *     modelContextUpdate: true, // Widgets can update model context
   *     widgetTools: true,        // Widgets can register dynamic tools
   *     displayModes: ['inline', 'fullscreen', 'pip'],
   *   },
   * }
   * ```
   *
   * @example Disable ext-apps
   * ```typescript
   * extApps: { enabled: false }
   * ```
   */
  extApps?: ExtAppsOptionsInput;

  /**
   * SQLite storage configuration for local-only deployments.
   * Provides session, elicitation, and event persistence without Redis.
   * Used by the Unix socket daemon mode and other local runtimes.
   */
  sqlite?: SqliteOptionsInput;

  /**
   * Default package loader config for all npm/esm apps.
   * Individual apps can override this via `packageConfig.loader`.
   */
  loader?: PackageLoader;

  /**
   * UI rendering configuration: CDN overrides for widget import resolution, and server-wide
   * defaults for the tools' `ui` (`escapeStringResults`, `servingMode`).
   *
   * @example Override @frontmcp/ui to load from local dev server
   * ```typescript
   * ui: {
   *   cdnOverrides: {
   *     '@frontmcp/ui': 'http://localhost:5173/@frontmcp/ui',
   *   },
   * }
   * ```
   */
  ui?: {
    cdnOverrides?: Record<string, string>;
    /**
     * Default for each tool's `ui.escapeStringResults`: HTML-escape plain strings returned by
     * template functions, while `ctx.helpers.html` / `trustedHtml` results stay markup.
     * Unset is the default since 1.9.2 (strings are escaped, with a one-time notice per tool when one
     * looked like markup); `false` renders strings that look like HTML as markup.
     */
    escapeStringResults?: boolean;
    /**
     * Serving mode for every tool whose `ui` does not set `servingMode` (an `@App({ ui })` default
     * overrides it for that app's tools). Same values as a tool's `ui.servingMode`; unset means
     * `'auto'`, which renders the widget into every `tools/call` result (`_meta['ui/html']`).
     *
     * @example MCP Apps hosts and ChatGPT load widgets from `ui://` — skip the per-call page
     * ```typescript
     * ui: { servingMode: 'static' }
     * ```
     */
    servingMode?: WidgetServingMode;
  };

  /**
   * Output policy applied to every tool (overridable per `@App` / `@Tool`):
   *
   * - `allowNonFinite`: lets `Infinity` / `-Infinity` / `NaN` reach JSON serialization
   *   (where they become `null`). Default `false` — non-finite output throws
   *   `InvalidOutputError`, surfacing silent `JSON.stringify` corruption.
   * - `schemaMode`: how `outputSchema` is exposed in `tools/list` — `'definition'`
   *   (default) / `'description'` / `'both'` / `'none'`.
   * - `undeclaredKeys`: what `tools/call` does with keys an answer carries that its
   *   `outputSchema` does not declare — `'strip'` / `'warn'` / `'keep'` / `'fail'`. Default
   *   `'warn'` when `NODE_ENV` is `'development'`, otherwise `'strip'`.
   *
   * - `budget`: the most bytes a tool answer or a resource read may take as JSON (`maxBytes`),
   *   and which end of a list to keep (`lists`). Off unless set.
   *
   * @default { allowNonFinite: false, schemaMode: 'definition' }
   */
  output?: OutputPolicy;

  /**
   * Per-client answer shaping, keyed by a glob of the `clientInfo.name` a client sends at
   * `initialize`: whether answers carry text, `structuredContent` or both, the resource annotations
   * and the skills instructions it receives. See {@link ClientProfilesOptionsInput}.
   */
  clients?: ClientProfilesOptionsInput;

  /**
   * Jobs and workflows configuration.
   * Enables the jobs/workflows system for saved, discoverable, triggerable executions.
   *
   * @default { enabled: false }
   *
   * @example Enable jobs system
   * ```typescript
   * jobs: { enabled: true }
   * ```
   *
   * @example With Redis store
   * ```typescript
   * jobs: {
   *   enabled: true,
   *   store: { redis: { provider: 'redis', host: 'localhost' } }
   * }
   * ```
   *
   * @example Runs kept in a SQLite file, two at a time, each claiming 2 GB of free memory
   * ```typescript
   * jobs: {
   *   enabled: true,
   *   store: { sqlite: { path: '~/.my-server/jobs.db' } },
   *   admission: { concurrency: 2, memoryMb: 2_048 },
   * }
   * ```
   */
  jobs?: {
    enabled: boolean;
    /**
     * Allow `register_job` / `register_workflow` to register a job from a raw
     * script string at runtime. Off by default — see JobsConfig.
     *
     * @default false
     */
    allowDynamicRegistration?: boolean;
    /**
     * Where runs and dynamic definitions are kept: Redis, or a SQLite file the processes on one machine
     * share (`@frontmcp/storage-sqlite`). Without one, the top-level `redis` (unless Vercel KV), then
     * the top-level `sqlite`, then memory. `false` keeps them in memory although the server has a top-level
     * `redis` or `sqlite`.
     */
    store?:
      | false
      | {
          redis?: RedisOptionsInput;
          sqlite?: SqliteOptionsInput & { path: string };
          keyPrefix?: string;
        };
    /**
     * How long an attempt of a job that sets no `timeout` may run, in ms, before it ends as `timed_out`;
     * 0 for no limit.
     *
     * @default 300000
     */
    defaultTimeoutMs?: number;
    /**
     * Where the attempts of a job that sets no `runner` run: `'inline'` on the server's event loop, `'worker'` in a
     * worker thread of the offload pool, `'detached'` in a process of their own that survives a server restart
     * (Node only, from the server's entry, with a store other processes share).
     *
     * @default 'inline'
     */
    runner?: 'inline' | 'worker' | 'detached';
    /**
     * When job attempts (and workflow steps) may start in this process: at most `concurrency` at once,
     * each claiming `memoryMb` of free memory. An attempt waits up to `maxWaitMs` (default 600000) and
     * is then refused with `JOB_ADMISSION_TIMEOUT`.
     */
    admission?: {
      concurrency?: number;
      memoryMb?: number;
      maxWaitMs?: number;
    };
  };

  /**
   * Rate limiting, concurrency control, and timeout configuration.
   * Controls global and default throttle behavior for all entities.
   *
   * @default { enabled: false }
   *
   * @example Global rate limiting by IP
   * ```typescript
   * throttle: {
   *   enabled: true,
   *   global: { maxRequests: 1000, windowMs: 60_000, partitionBy: 'ip' },
   *   defaultTimeout: { executeMs: 30_000 },
   * }
   * ```
   *
   * @example With Redis backend and per-tool defaults
   * ```typescript
   * throttle: {
   *   enabled: true,
   *   defaultRateLimit: { maxRequests: 60, windowMs: 60_000, partitionBy: 'session' },
   *   defaultConcurrency: { maxConcurrent: 10 },
   *   defaultTimeout: { executeMs: 30_000 },
   * }
   * ```
   */
  throttle?: GuardConfig;

  /**
   * Health and readiness endpoint configuration.
   * Provides Kubernetes-style `/healthz` (liveness) and `/readyz` (readiness) probes
   * with runtime introspection, dependency health probing, and catalog hashing.
   *
   * **Runtime matrix:**
   * - Node/Bun/Deno/Browser: `/healthz` + `/readyz`
   * - Edge/Cloudflare/Vercel: `/healthz` only
   * - CLI: `/healthz` only
   *
   * @default { enabled: true }
   *
   * @example Default (auto-enabled)
   * ```typescript
   * // health endpoints enabled by default
   * ```
   *
   * @example Custom probes
   * ```typescript
   * health: {
   *   probes: [{
   *     name: 'postgres',
   *     async check() {
   *       await pool.query('SELECT 1');
   *       return { status: 'healthy' };
   *     },
   *   }],
   * }
   * ```
   */
  health?: HealthOptionsInput;

  /**
   * `/metrics` endpoint configuration (issue #397).
   *
   * OFF by default. When `enabled: true`, registers a `GET /metrics`
   * endpoint on the same HTTP listener as `/healthz` that emits Prometheus
   * text exposition (or JSON, via `format: 'json'`) covering:
   *   - process metrics — CPU, RSS, heap, event-loop lag, fd count
   *   - every `@frontmcp/observability` counter (`frontmcp_*_total`)
   *
   * Re-uses the in-memory counter snapshot store from
   * `@frontmcp/observability`, so counters emitted via `createCounter()`
   * are scraped without needing an OTel push pipeline.
   *
   * @example Enable with defaults
   * ```typescript
   * metrics: { enabled: true }
   * ```
   *
   * @example Token-gated for internet-exposed deployments
   * ```typescript
   * metrics: {
   *   enabled: true,
   *   auth: 'token',
   *   tokenEnv: 'FRONTMCP_METRICS_TOKEN',
   * }
   * ```
   */
  metrics?: MetricsOptionsInput;

  /** MCP Registry domain proof, SEP-2127 server card and AI Catalog. See `McpRegistryOptionsInterface`. */
  registry?: McpRegistryOptionsInput;

  /**
   * Observability configuration — OpenTelemetry tracing, structured logging,
   * and per-request log collection.
   *
   * When set, the SDK auto-loads `@frontmcp/observability` and registers
   * instrumentation hooks for all flows. No explicit plugin import needed.
   *
   * - `true` — enable tracing with defaults
   * - Object — fine-grained control
   *
   * Requires `@frontmcp/observability` to be installed as a dependency.
   *
   * @example
   * ```typescript
   * observability: {
   *   tracing: true,
   *   logging: { sinks: [{ type: 'stdout' }] },
   *   requestLogs: true,
   * }
   * ```
   */
  observability?: ObservabilityOptionsInterface | boolean;

  /**
   * Channels configuration for Claude Code real-time notifications.
   * Enables push-based event channels using the `notifications/claude/channel` extension.
   *
   * When enabled, the server advertises `experimental: { 'claude/channel': {} }` capability.
   * Channels can be declared via `@Channel()` decorator or `channel()` function builder
   * in app definitions.
   *
   * Supported sources: webhook, app-event, agent-completion, job-completion, manual.
   *
   * @default { enabled: false }
   *
   * @example Enable channels
   * ```typescript
   * channels: { enabled: true }
   * ```
   *
   * @example With default metadata for all notifications
   * ```typescript
   * channels: {
   *   enabled: true,
   *   defaultMeta: { server: 'my-app', team: 'platform' },
   * }
   * ```
   */
  channels?: ChannelsConfigInput;

  /**
   * Authorities configuration for built-in RBAC/ABAC/ReBAC enforcement.
   * Enables the `checkEntryAuthorities` and `filterByAuthorities` flow stages
   * that enforce `authorities` metadata on tools, resources, and prompts.
   *
   * @example Simple role-based setup
   * ```typescript
   * authorities: {
   *   claimsMapping: { roles: 'roles', permissions: 'permissions' },
   *   profiles: {
   *     admin: { roles: { any: ['admin', 'superadmin'] } },
   *   },
   * }
   * ```
   *
   * @example With JWT claims mapping for Keycloak
   * ```typescript
   * authorities: {
   *   claimsMapping: { roles: 'realm_access.roles', permissions: 'scope' },
   *   profiles: {
   *     admin: { roles: { any: ['admin'] } },
   *     matchTenant: {
   *       attributes: {
   *         conditions: [{ path: 'claims.org_id', op: 'eq', value: { fromInput: 'tenantId' } }],
   *       },
   *     },
   *   },
   * }
   * ```
   */
  authorities?: import('@frontmcp/auth').AuthoritiesConfig;

  /**
   * Background tasks configuration per MCP 2025-11-25 tasks spec.
   *
   * Enabled automatically when any tool declares `execution.taskSupport` other
   * than `'forbidden'`. Explicitly set `enabled: false` to disable, or provide
   * custom defaults / a Redis-backed store for multi-node deployments.
   *
   * @example Default (memory, single-node)
   * ```typescript
   * tasks: { enabled: true }
   * ```
   *
   * @example Distributed with Redis
   * ```typescript
   * tasks: {
   *   enabled: true,
   *   redis: { provider: 'redis', host: 'localhost' },
   *   defaultTtlMs: 300_000,
   *   maxTtlMs: 3_600_000,
   * }
   * ```
   */
  tasks?: {
    enabled?: boolean;
    /** `false` keeps tasks in memory although the server has a top-level `redis` or `sqlite`. */
    store?: false;
    redis?: RedisOptionsInput;
    keyPrefix?: string;
    defaultTtlMs?: number;
    maxTtlMs?: number;
    defaultPollIntervalMs?: number;
    /** Unfinished tasks a caller may have at once (per session, or per subject under 2026-07-28); default 16, at most 1000. */
    maxConcurrentPerSession?: number;
    /**
     * Throw at startup instead of warning when the runtime cannot run tasks
     * reliably (edge/serverless). Default: `false`.
     */
    strict?: boolean;
    /** Runner selection — see `TasksConfig.runner`. */
    runner?: 'in-process' | 'cli';
    /**
     * Back the task store with a SQLite database (single-file, local, no Redis
     * needed). Required for cross-invocation persistence in CLI mode.
     */
    sqlite?: {
      path: string;
      encryption?: { secret: string };
      walMode?: boolean;
      ttlCleanupIntervalMs?: number;
      /** Ms to wait for a lock held by another process before `SQLITE_BUSY`. Default: 5000. */
      busyTimeoutMs?: number;
    };
    /**
     * Command used by the CLI task runner to spawn detached worker processes.
     * When unset, the runner re-invokes the currently-running executable.
     */
    cliRunnerCommand?: {
      exe: string;
      args?: string[];
    };
  };
}

/** A path, or the manifest itself: its fields are checked when a lazy app reads it. */
const serverManifestOptionSchema = z.union(
  [z.string().min(1), z.custom<ServerManifest>((value) => typeof value === 'object' && value !== null)],
  { message: '`manifest` must be the path of a frontmcp.manifest.json, or the manifest itself' },
);

/** Why `jobs.store` was refused: the field of its object that is wrong, or the values it takes. */
function jobsStoreError(issue: { code?: string; errors?: Array<Array<{ path: PropertyKey[]; message: string }>> }) {
  if (issue.code !== 'invalid_union') return undefined;
  const nested = issue.errors?.flat().find((error) => error.path.length > 0);
  if (nested) return `jobs.store.${nested.path.map(String).join('.')}: ${nested.message}`;
  return 'jobs.store must be false (runs kept in memory) or an object with redis or sqlite';
}

export const frontMcpBaseSchema = z.object({
  info: serverInfoOptionsSchema,
  // Captured call-site dir (#469 — anchors auth.ui relative paths). Passthrough
  // so it survives the strict-object parse and reaches the scope metadata.
  __sourceDir: z.string().optional(),
  instructions: z.string().optional(),
  instructionsBudget: instructionsBudgetOptionsSchema.optional(),
  manifest: serverManifestOptionSchema.optional(),
  providers: z.array(annotatedFrontMcpProvidersSchema).optional().default([]),
  lifecycle: lifecycleOptionsSchema.optional(),
  offload: offloadOptionsSchema.optional(),
  devtools: devtoolsOptionsSchema.optional(),
  tools: z.array(annotatedFrontMcpToolsSchema).optional().default([]),
  resources: z.array(annotatedFrontMcpResourcesSchema).optional().default([]),
  skills: z.array(annotatedFrontMcpSkillsSchema).optional().default([]),
  plugins: z.array(annotatedFrontMcpPluginsSchema).optional().default([]),
  adapters: z.array(annotatedFrontMcpAdaptersSchema).optional().default([]),
  apps: z.array(annotatedFrontMcpAppSchema),
  serve: z.boolean().optional().default(true),
  http: httpOptionsSchema.optional(),
  redis: redisOptionsSchema.optional(),
  pubsub: pubsubOptionsSchema.optional(),
  transport: transportOptionsSchema.optional().transform((val) => val ?? transportOptionsSchema.parse({})),
  // Deprecated and ignored (#702): kept so `warnIfSessionModeIgnored` can warn about it at startup
  session: legacySessionOptionsSchema.optional(),
  logging: loggingOptionsSchema.optional(),
  pagination: paginationOptionsSchema.optional(),
  fetch: outboundFetchOptionsSchema.optional(),
  elicitation: elicitationOptionsSchema.optional(),
  skillsConfig: skillsConfigOptionsSchema.optional(),
  extApps: extAppsOptionsSchema.optional(),
  sqlite: sqliteOptionsSchema.optional(),
  ui: z
    .object({
      cdnOverrides: z.record(z.string(), z.string()).optional(),
      escapeStringResults: z.boolean().optional(),
      servingMode: widgetServingModeSchema.optional(),
    })
    .optional(),
  /**
   * Output-validation policy applied after entry-level Zod parsing succeeds.
   * `allowNonFinite: true` lets `Infinity`, `-Infinity`, and `NaN` reach JSON
   * serialization (where they become `null`). Default is `false` — non-finite
   * numeric output throws `InvalidOutputError`.
   */
  output: outputPolicySchema.optional(),
  clients: clientProfilesOptionsSchema.optional(),
  jobs: z
    .object({
      enabled: z.boolean(),
      // Opt-in for `register_job` / `register_workflow` (GHSA-58v2-gpcc-jmqv).
      // Omitting it here would let Zod strip the flag before the scope reads
      // it, leaving the documented escape hatch permanently off.
      allowDynamicRegistration: z.boolean().optional(),
      store: z
        .union(
          [
            z.literal(false),
            z
              .object({
                redis: redisOptionsSchema.optional(),
                sqlite: sqliteOptionsSchema.extend({ path: z.string().min(1) }).optional(),
                keyPrefix: z.string().optional(),
              })
              .refine((store) => !(store.redis && store.sqlite), {
                message: 'jobs.store takes redis or sqlite, not both',
              }),
          ],
          { error: jobsStoreError },
        )
        .optional(),
      defaultTimeoutMs: z
        .number()
        .int()
        .nonnegative()
        .max(MAX_JOB_TIMER_MS, timerLimitMessage('jobs.defaultTimeoutMs'))
        .optional(),
      runner: z
        .enum(['inline', 'worker', 'detached'], { message: "jobs.runner must be 'inline', 'worker' or 'detached'" })
        .optional(),
      admission: z
        .object({
          concurrency: z.number().int().positive().optional(),
          memoryMb: z.number().positive().optional(),
          maxWaitMs: z.number().int().nonnegative().optional(),
        })
        .optional(),
    })
    .optional(),
  loader: packageLoaderSchema.optional(),
  throttle: guardConfigSchema.optional(),
  observability: observabilityOptionsSchema,
  health: healthOptionsSchema.optional(),
  metrics: metricsOptionsSchema.optional(),
  registry: mcpRegistryOptionsSchema.optional(),
  channels: channelsConfigSchema.optional(),
  authorities: z
    .object({
      claimsMapping: z.record(z.string(), z.string().optional()).optional(),
      profiles: z.record(z.string(), z.looseObject({})).optional(),
      relationshipResolver: z.any().optional(),
      evaluators: z.record(z.string(), z.any()).optional(),
      claimsResolver: z.any().optional(),
      scopeMapping: z
        .object({
          roles: z.record(z.string(), z.array(z.string())).optional(),
          permissions: z.record(z.string(), z.array(z.string())).optional(),
          profiles: z.record(z.string(), z.array(z.string())).optional(),
        })
        .optional(),
      pipes: z.array(z.any()).optional(),
    })
    .optional(),
  tasks: z
    .object({
      enabled: z.boolean().optional(),
      store: z.literal(false, { error: 'tasks.store must be false (tasks kept in memory)' }).optional(),
      redis: redisOptionsSchema.optional(),
      keyPrefix: z.string().optional(),
      defaultTtlMs: z.number().int().positive().optional(),
      maxTtlMs: z.number().int().positive().optional(),
      defaultPollIntervalMs: z.number().int().positive().optional(),
      maxConcurrentPerSession: z.number().int().positive().max(MAX_CONCURRENT_TASKS_PER_SESSION).optional(),
      strict: z.boolean().optional(),
      runner: z.enum(['in-process', 'cli']).optional(),
      sqlite: z
        .object({
          path: z.string().min(1),
          encryption: z.object({ secret: z.string().min(1) }).optional(),
          walMode: z.boolean().optional(),
          ttlCleanupIntervalMs: z.number().int().positive().optional(),
          busyTimeoutMs: z.number().int().nonnegative().optional(),
        })
        .optional(),
      cliRunnerCommand: z
        .object({
          exe: z.string().min(1),
          args: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .refine((tasks) => !(tasks.store === false && (tasks.redis || tasks.sqlite)), {
      message: 'tasks.store: false keeps tasks in memory, so it takes no tasks.redis or tasks.sqlite',
    })
    .optional(),
} satisfies RawZodShape<FrontMcpBaseMetadata>);

export interface FrontMcpMultiAppMetadata extends FrontMcpBaseMetadata {
  splitByApp?: false;
  auth?: AuthOptionsInput;
}

const frontMcpMultiAppSchema = frontMcpBaseSchema.extend({
  splitByApp: z.literal(false).default(false).describe('If true, each app gets its own scope & basePath.'),
  auth: authOptionsSchema.optional().describe("Configures the server's default authentication provider."),
} satisfies RawZodShape<FrontMcpMultiAppMetadata, FrontMcpBaseMetadata>);

export interface FrontMcpSplitByAppMetadata extends FrontMcpBaseMetadata {
  splitByApp: true;
  auth?: AuthOptionsInput;
}

const frontMcpSplitByAppSchema = frontMcpBaseSchema.extend({
  splitByApp: z.literal(true).describe('If false, apps are grouped under the same scope & basePath.'),
  auth: authOptionsSchema.optional().describe("Configures the server's default authentication provider."),
} satisfies RawZodShape<FrontMcpSplitByAppMetadata, FrontMcpBaseMetadata>);

export type FrontMcpMetadata = FrontMcpMultiAppMetadata | FrontMcpSplitByAppMetadata;

/**
 * Type guard for persistence object shape (simplified - no enabled flag)
 */
function isPersistenceObject(
  value: unknown,
): value is { redis?: unknown; defaultTtlMs?: number } | false | undefined | null {
  if (value === undefined || value === null) return true;
  if (value === false) return true; // Explicitly disabled
  if (typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  // Check optional properties have correct types if present
  if ('defaultTtlMs' in obj && typeof obj['defaultTtlMs'] !== 'number') return false;
  return true;
}

/**
 * Transform function to auto-populate transport.persistence from global redis config.
 * This enables automatic transport session persistence when global redis is configured.
 *
 * New simplified behavior:
 * - `persistence: false` → explicitly disabled
 * - `persistence: { redis?: ... }` → enabled with config
 * - `persistence: undefined` → auto-enable when global redis exists
 *
 * Behavior:
 * - If redis is set AND transport.persistence is not configured → auto-enable with global redis
 * - If transport.persistence is false → respect explicit disable
 * - If transport.persistence.redis is explicitly set → use that config
 * - If transport.persistence is object without redis → use global redis
 */
function applyAutoTransportPersistence<T extends { redis?: unknown; transport?: { persistence?: unknown } }>(
  data: T,
): T {
  // If no global redis config, nothing to auto-enable
  if (!data.redis) return data;

  // Safe access with type guard validation
  const transport = data.transport as { persistence?: unknown } | undefined;
  const rawPersistence = transport?.persistence;

  // Validate persistence shape at runtime (should always pass after Zod validation)
  if (!isPersistenceObject(rawPersistence)) {
    return data; // Invalid shape, don't modify
  }

  // Case 1: persistence explicitly disabled (false) - respect that
  if (rawPersistence === false) {
    return data;
  }

  // Case 2: persistence is an object with explicit redis config - use that
  if (rawPersistence && typeof rawPersistence === 'object' && 'redis' in rawPersistence && rawPersistence.redis) {
    return data;
  }

  // Case 3: persistence is an object without redis - use global redis
  if (rawPersistence && typeof rawPersistence === 'object') {
    return {
      ...data,
      transport: {
        ...transport,
        persistence: {
          ...rawPersistence,
          redis: data.redis,
        },
      },
    };
  }

  // Case 4: persistence not configured at all - auto-enable with global redis
  if (rawPersistence === undefined) {
    return {
      ...data,
      transport: {
        ...transport,
        persistence: {
          redis: data.redis,
        },
      },
    };
  }

  return data;
}

export const frontMcpMetadataSchema = frontMcpMultiAppSchema
  .or(frontMcpSplitByAppSchema)
  .transform(applyAutoTransportPersistence);

/** The server's schema checks the value of `key`, which CLI mode keeps as given: the server's defaults would change it. */
function checkedAsServer(key: keyof typeof frontMcpBaseSchema.shape) {
  return z
    .unknown()
    .superRefine((value, ctx) => {
      if (value === undefined) return;
      const issues = frontMcpBaseSchema.shape[key].safeParse(value).error?.issues ?? [];
      for (const issue of issues) ctx.addIssue({ ...issue });
    })
    .optional();
}

/** Keys the server validates and CLI mode leaves off: checked, then left out of its config. */
const CLI_OFF_KEYS = ['session', 'clients', 'observability', 'registry', 'channels'] as const;

/**
 * Lite config parser for CLI mode.
 * Fully parses only the fields needed for tool/resource execution; the others are checked with the server's schemas
 * and kept as given, so CLI mode runs without the server's defaults for transport, HTTP, elicitation and the rest.
 */
const frontMcpLiteSchema = z.object({
  info: serverInfoOptionsSchema,
  // Captured call-site dir (#469) — round-trip through the lite parser too.
  __sourceDir: z.string().optional(),
  // Server-level instructions injected into the MCP `initialize` response.
  // Must round-trip through the lite parser so CLI/MCPB builds preserve it.
  instructions: z.string().optional(),
  instructionsBudget: instructionsBudgetOptionsSchema.optional(),
  manifest: serverManifestOptionSchema.optional(),
  providers: z.array(annotatedFrontMcpProvidersSchema).optional().default([]),
  lifecycle: lifecycleOptionsSchema.optional(),
  offload: offloadOptionsSchema.optional(),
  devtools: devtoolsOptionsSchema.optional(),
  tools: z.array(annotatedFrontMcpToolsSchema).optional().default([]),
  resources: z.array(annotatedFrontMcpResourcesSchema).optional().default([]),
  skills: z.array(annotatedFrontMcpSkillsSchema).optional().default([]),
  plugins: z.array(annotatedFrontMcpPluginsSchema).optional().default([]),
  adapters: z.array(annotatedFrontMcpAdaptersSchema).optional().default([]),
  apps: z.array(annotatedFrontMcpAppSchema),
  serve: z.boolean().optional().default(false),
  splitByApp: z.boolean().optional().default(false),
  auth: authOptionsSchema.optional(),
  logging: loggingOptionsSchema.optional(),
  skillsConfig: skillsConfigOptionsSchema.optional(),
  loader: packageLoaderSchema.optional(),
  http: checkedAsServer('http'),
  pubsub: checkedAsServer('pubsub'),
  transport: checkedAsServer('transport').transform((val) => val ?? transportOptionsSchema.parse({})),
  pagination: checkedAsServer('pagination'),
  fetch: checkedAsServer('fetch'),
  elicitation: checkedAsServer('elicitation'),
  extApps: checkedAsServer('extApps'),
  ui: checkedAsServer('ui'),
  // The CLI host picks the stores and runners of its tasks and jobs from these
  redis: frontMcpBaseSchema.shape.redis,
  sqlite: frontMcpBaseSchema.shape.sqlite,
  jobs: frontMcpBaseSchema.shape.jobs,
  tasks: frontMcpBaseSchema.shape.tasks,
  throttle: checkedAsServer('throttle'),
  health: checkedAsServer('health'),
  metrics: checkedAsServer('metrics'),
  // Kept as given, as the scope's authorities engine reads it (#366): the server's schema drops keys it doesn't know
  authorities: checkedAsServer('authorities'),
  // Output-validation policy (see `frontMcpBaseSchema.output`). CLI mode
  // honors the same `allowNonFinite` switch as the full server.
  output: outputPolicySchema.optional(),
  session: checkedAsServer('session'),
  clients: checkedAsServer('clients'),
  observability: checkedAsServer('observability'),
  registry: checkedAsServer('registry'),
  channels: checkedAsServer('channels'),
});

/**
 * Parse config for CLI mode: an invalid value fails as on the server, and a valid one is kept without the server's
 * defaults or its transport auto-persistence.
 */
export function parseFrontMcpConfigLite(input: FrontMcpConfigInput | FrontMcpConfigType): FrontMcpConfigType {
  const config: Record<string, unknown> = frontMcpLiteSchema.parse(input);
  for (const key of CLI_OFF_KEYS) delete config[key];
  return config as unknown as FrontMcpConfigType;
}

export type FrontMcpMultiAppConfig = z.infer<typeof frontMcpMultiAppSchema>;
export type FrontMcpSplitByAppConfig = z.infer<typeof frontMcpSplitByAppSchema>;

/** Output type after zod parsing (with defaults applied) */
export type FrontMcpConfigType = z.infer<typeof frontMcpMetadataSchema>;

/** Input type for FrontMCP configuration (before zod defaults) */
export type FrontMcpConfigInput = z.input<typeof frontMcpMetadataSchema>;

export interface AppScopeMetadata extends Omit<FrontMcpSplitByAppMetadata, 'splitByApp'> {
  id: string;
  apps: [AppType];
  auth?: AuthOptions;
}

export interface MultiAppScopeMetadata extends FrontMcpMultiAppMetadata {
  id: string;
  apps: AppType[];
}

export type ScopeMetadata = AppScopeMetadata | MultiAppScopeMetadata;
