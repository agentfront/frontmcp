// common/types/options/skills-http/interfaces.ts

/**
 * @module skillsConfig
 *
 * Skills HTTP Endpoints Configuration
 *
 * This module enables exposing FrontMCP skills via HTTP endpoints for multi-agent
 * architectures where:
 * - **Planner agents** fetch skills via HTTP to create execution plans
 * - **Sub-agents** connect to specific apps for tool execution without skills
 * - **Backend servers** fetch skills via HTTP GET before calling LLMs
 *
 * ## HTTP Endpoints
 *
 * When `skillsConfig.enabled: true`, the following endpoints are available:
 *
 * | Endpoint          | Method | Description                                    |
 * |-------------------|--------|------------------------------------------------|
 * | `/llm.txt`        | GET    | Compact skill summaries (name, description, tools, tags) |
 * | `/llm_full.txt`   | GET    | Full skills with complete instructions and tool schemas |
 * | `/skills`         | GET    | JSON API - List all skills                     |
 * | `/skills?query=X` | GET    | JSON API - Search skills with optional filters |
 * | `/skills/{id}`    | GET    | JSON API - Get specific skill by ID/name       |
 *
 * ## Visibility Control
 *
 * Skills can have a `visibility` property to control where they appear:
 * - `'mcp'`: Only via skill:// MCP resources
 * - `'http'`: Only via HTTP API endpoints (/llm.txt, /skills)
 * - `'both'`: Visible in both MCP and HTTP (default)
 *
 * ```typescript
 * @Skill({
 *   name: 'internal-process',
 *   visibility: 'http',  // Only visible via HTTP endpoints
 *   instructions: { file: './internal.md' },
 * })
 * class InternalProcessSkill {}
 * ```
 *
 * ## Architecture Examples
 *
 * ### Multi-Agent Architecture
 * ```
 * ┌──────────────────┐     HTTP GET /skills
 * │  Planner Agent   │ ──────────────────────> FrontMCP Server
 * └────────┬─────────┘                               │
 *          │ creates plan                            │ /llm.txt
 *          ▼                                         │ /skills
 * ┌──────────────────┐     MCP (tools only)          ▼
 * │  Executor Agent  │ <──────────────────── Tools (no skills listed)
 * └──────────────────┘
 * ```
 *
 * ### Backend Server Integration
 * ```typescript
 * // Fetch skills before calling LLM
 * const skills = await fetch('https://api.example.com/llm.txt');
 * const systemPrompt = `Available skills:\n${await skills.text()}`;
 *
 * // Call LLM with skill context
 * const response = await llm.chat({ system: systemPrompt, user: query });
 * ```
 *
 * @see {@link SkillsConfigOptions} for configuration options
 * @see {@link SkillMetadata.visibility} for per-skill visibility control
 */

/**
 * Authentication mode for skills HTTP endpoints.
 * - 'inherit': Use the server's default authentication
 * - 'public': No authentication required
 * - 'api-key': Require API key in X-API-Key header or Authorization: ApiKey <key>
 * - 'bearer': Require JWT token, validated against configured issuer
 */
export type SkillsConfigAuthMode = 'inherit' | 'public' | 'api-key' | 'bearer';

/**
 * JWT validation configuration for bearer auth mode.
 */
export interface SkillsConfigJwtOptions {
  /**
   * JWT issuer URL (e.g., 'https://auth.example.com').
   * Required when using bearer auth mode.
   */
  issuer: string;

  /**
   * Expected audience claim (optional).
   * If provided, the JWT must have this audience.
   */
  audience?: string;

  /**
   * JWKS URL for key discovery.
   * Defaults to {issuer}/.well-known/jwks.json
   */
  jwksUrl?: string;
}

/**
 * Configuration for an individual skills HTTP endpoint.
 * Controls whether the endpoint is enabled and its path.
 * Authentication is configured at the top level of SkillsConfigOptions.
 */
export interface SkillsConfigEndpointConfig {
  /**
   * Whether this endpoint is enabled.
   * @default true
   */
  enabled?: boolean;

  /**
   * Custom path override for this endpoint.
   * If not specified, uses the default path.
   */
  path?: string;
}

/**
 * Options for exposing skills via HTTP endpoints.
 *
 * When enabled, skills can be discovered and loaded via HTTP endpoints
 * in addition to (or instead of) MCP tools.
 *
 * Authentication is configured once at the top level and applies to all
 * HTTP endpoints. Individual endpoints can be enabled/disabled separately.
 *
 * @example Basic usage (public access)
 * ```typescript
 * @FrontMcp({
 *   skillsConfig: {
 *     enabled: true,
 *     auth: 'public',
 *   },
 * })
 * ```
 *
 * @example Protected API with API key
 * ```typescript
 * @FrontMcp({
 *   skillsConfig: {
 *     enabled: true,
 *     auth: 'api-key',
 *     apiKeys: ['sk-xxx', 'sk-yyy'],
 *   },
 * })
 * ```
 *
 * @example Custom paths with prefix
 * ```typescript
 * @FrontMcp({
 *   skillsConfig: {
 *     enabled: true,
 *     prefix: '/api/v1',
 *     auth: 'public',
 *     llmTxt: { path: '/api/v1/llm.txt' },
 *     api: { enabled: false },  // Disable JSON API
 *   },
 * })
 * ```
 *
 * @example HTTP only (no MCP resources)
 * ```typescript
 * @FrontMcp({
 *   skillsConfig: {
 *     enabled: true,
 *     auth: 'public',
 *     mcpResources: false,  // No skill:// MCP resource templates
 *   },
 * })
 * ```
 */
export interface SkillsConfigOptions {
  /**
   * Whether skills HTTP endpoints are enabled.
   * @default false (opt-in feature)
   */
  enabled?: boolean;

  /**
   * Prefix for all skills HTTP endpoints.
   * @example '/api' results in '/api/llm.txt', '/api/skills', etc.
   */
  prefix?: string;

  /**
   * Authentication mode for all skills HTTP endpoints.
   * This single setting applies to /llm.txt, /llm_full.txt, and /skills.
   *
   * - 'inherit': Use the server's default authentication (default)
   * - 'public': No authentication required
   * - 'api-key': Require API key in X-API-Key header
   * - 'bearer': Require bearer token in Authorization header
   *
   * @default 'inherit'
   */
  auth?: SkillsConfigAuthMode;

  /**
   * API keys for 'api-key' authentication mode.
   * Only used when auth is 'api-key'.
   * Requests must include one of these keys in the X-API-Key header
   * or in Authorization header as `ApiKey <key>`.
   */
  apiKeys?: string[];

  /**
   * JWT validation configuration for 'bearer' authentication mode.
   * Required when auth is 'bearer'.
   *
   * @example
   * ```typescript
   * @FrontMcp({
   *   skillsConfig: {
   *     enabled: true,
   *     auth: 'bearer',
   *     jwt: {
   *       issuer: 'https://auth.example.com',
   *       audience: 'skills-api',
   *     },
   *   },
   * })
   * ```
   */
  jwt?: SkillsConfigJwtOptions;

  /**
   * Configuration for /llm.txt endpoint.
   * Provides compact skill summaries (name, description, tools, tags).
   *
   * Can be:
   * - `true`: Enable with defaults
   * - `false`: Disable this endpoint
   * - `{ enabled?: boolean; path?: string }`: Custom configuration
   *
   * @default true (when skillsConfig.enabled is true)
   */
  llmTxt?: SkillsConfigEndpointConfig | boolean;

  /**
   * Configuration for /llm_full.txt endpoint.
   * Provides full skill content with complete instructions and tool schemas.
   *
   * Can be:
   * - `true`: Enable with defaults
   * - `false`: Disable this endpoint
   * - `{ enabled?: boolean; path?: string }`: Custom configuration
   *
   * @default true (when skillsConfig.enabled is true)
   */
  llmFullTxt?: SkillsConfigEndpointConfig | boolean;

  /**
   * Configuration for /skills API endpoints.
   * Provides JSON API for listing, searching, and loading skills.
   *
   * Endpoints:
   * - GET /skills - List all skills
   * - GET /skills?query=X - Search skills
   * - GET /skills/{id} - Get specific skill by ID/name
   *
   * Can be:
   * - `true`: Enable with defaults
   * - `false`: Disable this endpoint
   * - `{ enabled?: boolean; path?: string }`: Custom configuration
   *
   * @default true (when skillsConfig.enabled is true)
   */
  api?: SkillsConfigEndpointConfig | boolean;

  /**
   * Whether to register the SEP-2640 (Skills Extension) `skill://`
   * MCP resource templates. Set to `false` to expose skills only via the
   * HTTP endpoints (`/llm.txt`, `/llm_full.txt`, `/skills`).
   *
   * When enabled (default), the following resources are registered:
   * - `skill://index.json`               — discovery index (agentskills.io schema)
   * - `skill://{+skillPath}/SKILL.md`    — raw SKILL.md (frontmatter + body)
   * - `skill://{+skillPath}/{+filePath}` — any file inside the skill directory
   *
   * @default true
   * @see https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2640
   */
  mcpResources?: boolean;

  /**
   * SEP-2640 §Discovery — opt-in inclusion of skill URIs in the server's
   * `instructions` field. When `true`, the transport adapter prepends a
   * short "Available skills:" block listing each MCP-visible skill's
   * `skill://` URI so models that only see server instructions can still
   * find them.
   *
   * @default false (opt-in to keep the instructions field lean by default)
   */
  sep2640InInstructions?: boolean;

  /**
   * Cache configuration for HTTP endpoints.
   * Reduces latency and CPU/memory overhead for repeated requests.
   *
   * @example Memory cache (default)
   * ```typescript
   * cache: { enabled: true, ttlMs: 30000 }
   * ```
   *
   * @example Redis cache
   * ```typescript
   * cache: {
   *   enabled: true,
   *   redis: { provider: 'redis', host: 'localhost' },
   *   ttlMs: 60000,
   * }
   * ```
   */
  cache?: SkillsConfigCacheOptions;

  /**
   * Tamper-evident audit log for skill action invocations.
   *
   * When enabled, every authority-pass / http-call-success / http-call-failure
   * for a skill action (run via `run_workflow`'s `callTool`) appends a signed,
   * hash-chained record to the
   * configured store. The chain can be verified with `verifyChain()` from
   * `@frontmcp/adapters/skills` — any retroactive edit to a single record
   * breaks the chain at that point.
   *
   * Configuration is held loosely-typed here so the SDK doesn't take a hard
   * import dependency on `@frontmcp/adapters/skills`. The skill scope helper
   * inspects this object at scope-init time and registers the
   * `SkillAuditWriterToken` provider when `enabled: true`.
   *
   * @example
   * ```typescript
   * import { Hs256AuditSigner, MemoryAuditStore } from '@frontmcp/adapters/skills';
   *
   * @FrontMcp({
   *   skillsConfig: {
   *     audit: {
   *       enabled: true,
   *       signer: new Hs256AuditSigner(process.env.AUDIT_SECRET, 'audit-prod'),
   *       store: new MemoryAuditStore(),
   *     },
   *   },
   * })
   * ```
   *
   * @default { enabled: false }
   */
  audit?: SkillsConfigAuditOptions;

  /**
   * How to merge bundle skill `instructions` into the MCP `initialize` response.
   *
   * The MCP `InitializeResult.instructions` field is a server-side "system
   * prompt" that clients typically inject verbatim into the model context.
   * Bundle skills carry their own `instructions` markdown; this option controls
   * whether and how those are aggregated alongside the server's
   * `instructions` (from `@FrontMcp({ instructions })`) and any framework
   * hints (e.g. channel reply-tool guidance).
   *
   * - `'append'` (default): `instructions` is sent as-is, followed by a
   *   `\n\n---\n\n` separator and the per-skill summary (`**Name**: …`
   *   blocks separated by `---`). Channel hints sit between them.
   * - `'prepend'`: the skill catalog summary is sent first, then channel
   *   hints, then the server `instructions`. Useful when bundle guidance
   *   must appear in the model's prefix.
   * - `'replace'`: surface ONLY the server `instructions` field — the
   *   skill catalog summary AND channel hints are dropped. Use when the
   *   server config is the canonical prompt and skills should be
   *   discovered via `searchSkills` instead. **When `instructions` is
   *   empty/undefined this falls back to `'append'` semantics** so a
   *   misconfigured server doesn't silently drop everything.
   * - `'off'`: never inject the bundle skill catalog into `initialize`.
   *   Server `instructions` AND channel hints are still surfaced — only
   *   the per-skill summary is suppressed. Lowest-cost option for very
   *   large catalogs (catalog summaries can otherwise blow context).
   *
   * @default 'append'
   */
  injectInstructions?: 'off' | 'append' | 'prepend' | 'replace';

  /**
   * Ranking function for skill semantic search (the in-memory vector index).
   *
   * - `'cosine'` (default): cosine similarity over normalized TF-IDF vectors.
   * - `'bm25'`: Okapi BM25 — term-saturating, length-normalized relevance,
   *   generally stronger for keyword-style queries over a large catalog.
   *
   * Only takes effect when the installed `vectoriadb` peer supports it (newer
   * versions); older versions silently fall back to cosine.
   *
   * @default 'cosine'
   */
  scoring?: 'cosine' | 'bm25';
}

/**
 * Loosely-typed audit configuration carried in `skillsConfig.audit`.
 *
 * The actual `SkillAuditSigner` / `SkillAuditStore` types live in
 * `@frontmcp/adapters/skills` — held as `unknown` here to keep the SDK free
 * of an upward dependency. The skill scope helper does the structural check
 * and creates default in-memory implementations when omitted.
 */
export interface SkillsConfigAuditOptions {
  /** Master switch. Default: false (opt-in feature). */
  enabled?: boolean;
  /**
   * Pluggable signer implementing the `SkillAuditSigner` interface from
   * `@frontmcp/adapters/skills`. When omitted, an HMAC-SHA256 signer with
   * a randomly-generated process-local secret is created. NOT suitable for
   * production — the secret is lost on restart.
   */
  signer?: unknown;
  /**
   * Pluggable store implementing the `SkillAuditStore` interface from
   * `@frontmcp/adapters/skills`. When omitted, an in-memory store is used
   * (suitable only for dev / single-pod). Production should use
   * `StorageAdapterAuditStore` against Redis/SQLite/Vercel KV.
   */
  store?: unknown;
  /**
   * How the `subject` field (typically JWT `sub`) is persisted in each
   * record. Forwarded to `SkillAuditWriter`. See `SkillAuditSubjectMode` in
   * `@frontmcp/adapters/skills`.
   *
   * @default 'hash'
   */
  subjectMode?: 'plain' | 'hash' | 'omit';
  /**
   * Periodic head-anchor interval (milliseconds). Reserved for v1.3.0
   * tail-truncation detection. Validated only — currently the writer does
   * not consume this value.
   */
  headAnchorIntervalMs?: number;
}

/**
 * Cache configuration for skills HTTP endpoints.
 */
export interface SkillsConfigCacheOptions {
  /**
   * Whether caching is enabled.
   * @default false (opt-in)
   */
  enabled?: boolean;

  /**
   * Redis configuration for distributed caching.
   * If not provided, falls back to in-memory cache.
   *
   * Note: 'redis' provider uses ioredis under the hood.
   */
  redis?: {
    /** Redis provider type */
    provider: 'redis' | 'vercel-kv' | '@vercel/kv';
    /** Redis host */
    host?: string;
    /** Redis port */
    port?: number;
    /** Redis password */
    password?: string;
    /** Redis database number */
    db?: number;
  };

  /**
   * Cache TTL in milliseconds.
   * @default 60000 (1 minute)
   */
  ttlMs?: number;

  /**
   * Key prefix for Redis cache.
   * @default 'frontmcp:skills:cache:'
   */
  keyPrefix?: string;
}
