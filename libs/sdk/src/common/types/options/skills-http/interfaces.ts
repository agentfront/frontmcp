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
 * - `'mcp'`: Only via searchSkills/loadSkill MCP tools
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
 * @example HTTP only (no MCP tools)
 * ```typescript
 * @FrontMcp({
 *   skillsConfig: {
 *     enabled: true,
 *     auth: 'public',
 *     mcpTools: false,  // No searchSkills/loadSkill MCP tools
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
   * Whether to include searchSkills/loadSkill MCP tools.
   * Set to false to expose skills only via HTTP endpoints.
   *
   * @default true
   */
  mcpTools?: boolean;

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
