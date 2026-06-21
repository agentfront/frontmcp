/**
 * FrontMCP Configuration Types
 *
 * Defines the unified deployment configuration schema.
 * Used by `frontmcp.config.(json|yml|js|ts)` files.
 *
 * Separation of concerns:
 * - frontmcp.config = deployment (targets, server defaults, cookies, CSP)
 * - @FrontMcp() = runtime (auth, tools, resources, transport)
 * - Environment variables = secrets/overrides (Redis password, API keys)
 */

// ============================================
// Server Defaults
// ============================================

export interface CorsConfig {
  /** Allowed origins. Empty array = permissive. */
  origins?: string[];
  /** Allow credentials (cookies, authorization headers). @default false */
  credentials?: boolean;
  /** Preflight cache max age in seconds. */
  maxAge?: number;
}

export interface CspConfig {
  /** Enable CSP headers. @default false */
  enabled?: boolean;
  /** CSP directives (e.g., 'default-src': "'self'"). */
  directives?: Record<string, string | string[]>;
  /** Report URI for CSP violations. */
  reportUri?: string;
  /** Use Content-Security-Policy-Report-Only instead. @default false */
  reportOnly?: boolean;
}

export interface CookiesConfig {
  /** LB affinity cookie name. @default '__frontmcp_node' */
  affinity?: string;
  /** Cookie domain. */
  domain?: string;
  /** SameSite policy. @default 'Strict' */
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface SecurityHeadersConfig {
  /** Strict-Transport-Security. Set to false to disable. */
  hsts?: string | false;
  /** X-Content-Type-Options. Set to false to disable. @default 'nosniff' */
  contentTypeOptions?: string | false;
  /** X-Frame-Options. Set to false to disable. @default 'DENY' */
  frameOptions?: string | false;
  /** Custom response headers. */
  custom?: Record<string, string>;
}

/**
 * HTTP options — aligns with `@FrontMcp({ http })`.
 *
 * Available on targets that serve HTTP:
 * - node, distributed: full (port + cors)
 * - vercel, lambda, cloudflare: no port (platform-managed), but cors applies
 * - browser, sdk, cli: not available
 */
export interface HttpConfig {
  /** HTTP port. Only for node/distributed. @default 3000 */
  port?: number;
  /** Unix socket path (alternative to port). Only for node/distributed. */
  socketPath?: string;
  /** MCP entry path ('' or '/mcp'). @default '' */
  entryPath?: string;
  /** CORS configuration. */
  cors?: CorsConfig;
}

/**
 * Server-level options for targets that handle HTTP responses.
 * Separated from HttpConfig because these apply even to serverless
 * targets that don't control the port (Cloudflare, Vercel, Lambda).
 */
export interface ServerDefaults {
  /** HTTP configuration (port, cors). */
  http?: HttpConfig;
  /** Content Security Policy. */
  csp?: CspConfig;
  /** Cookie configuration. */
  cookies?: CookiesConfig;
  /** Security headers. */
  headers?: SecurityHeadersConfig;
}

// ============================================
// Build Options
// ============================================

export interface EsbuildOptions {
  /** Dependencies to exclude from bundle. */
  external?: string[];
  /** Global defines. */
  define?: Record<string, string>;
  /** Build target (e.g., 'node22'). */
  target?: string;
  /** Minify output. */
  minify?: boolean;
}

export interface BuildOptions {
  /** esbuild/bundler options. */
  esbuild?: EsbuildOptions;
  /** System/native dependencies for CLI packaging. */
  dependencies?: {
    system?: string[];
    nativeAddons?: string[];
  };
  /** Storage type for CLI setup. */
  storage?: {
    type: 'sqlite' | 'redis' | 'none';
    required?: boolean;
  };
  /** Network defaults. */
  network?: {
    defaultPort?: number;
    supportsSocket?: boolean;
  };
}

// ============================================
// HA Configuration (distributed target only)
// ============================================

export interface HaDeploymentConfig {
  /** Heartbeat interval in ms. @default 10000 */
  heartbeatIntervalMs?: number;
  /** Heartbeat TTL in ms (should be 2-3x interval). @default 30000 */
  heartbeatTtlMs?: number;
  /** Grace period before claiming orphaned sessions. @default 5000 */
  takeoverGracePeriodMs?: number;
  /** Redis key prefix for HA keys. @default 'mcp:ha:' */
  redisKeyPrefix?: string;
}

// ============================================
// CLI Configuration (cli target only)
// ============================================

export interface CliTargetConfig {
  /** CLI description. */
  description?: string;
  /** Default output format. @default 'text' */
  outputDefault?: 'text' | 'json';
  /** Require authentication for CLI. */
  authRequired?: boolean;
  /** Tools to exclude from CLI. */
  excludeTools?: string[];
  /** OAuth configuration for CLI authentication. */
  oauth?: {
    serverUrl?: string;
    clientId?: string;
    defaultScope?: string;
    portRange?: [number, number];
  };
}

// ============================================
// Wrangler Configuration (cloudflare target only)
// ============================================

export interface WranglerConfig {
  /** Worker name. */
  name?: string;
  /** Compatibility date. Defaults to `2024-09-23` (the date that enables full `nodejs_compat`). */
  compatibilityDate?: string;
  /**
   * Extra Cloudflare compatibility flags. `nodejs_compat` is always emitted
   * (the FrontMCP worker entry requires Node builtins), so list only additions
   * here — e.g. `['nodejs_compat_populate_process_env']`.
   */
  compatibilityFlags?: string[];
}

// ============================================
// Deployment Targets
// ============================================

export type DeploymentTargetType =
  | 'node'
  | 'distributed'
  | 'cli'
  | 'vercel'
  | 'lambda'
  | 'cloudflare'
  | 'browser'
  | 'sdk'
  | 'mcpb';

interface DeploymentBase {
  /** Deployment target type. */
  target: DeploymentTargetType;
  /** Output directory override. @default 'dist/{target}' */
  outDir?: string;
  /** Environment variables injected at build time. */
  env?: Record<string, string>;
}

export interface NodeDeployment extends DeploymentBase {
  target: 'node';
  /** Server config (http with port, csp, cookies, headers). */
  server?: ServerDefaults;
}

export interface DistributedDeployment extends DeploymentBase {
  target: 'distributed';
  /** Server config (http with port, csp, cookies, headers). */
  server?: ServerDefaults;
  /** HA configuration. */
  ha?: HaDeploymentConfig;
}

export interface CliDeployment extends DeploymentBase {
  target: 'cli';
  /** Output JS bundle instead of native binary. */
  js?: boolean;
  /** CLI-specific configuration. */
  cli?: CliTargetConfig;
  /** Single Executable Application settings. */
  sea?: { enabled?: boolean };
}

export interface VercelDeployment extends DeploymentBase {
  target: 'vercel';
  /** Server config (no port — platform-managed, but cors/csp/cookies apply). */
  server?: ServerDefaults;
}

export interface LambdaDeployment extends DeploymentBase {
  target: 'lambda';
  /** Server config (no port — platform-managed, but cors/csp/cookies apply). */
  server?: ServerDefaults;
}

export interface CloudflareDeployment extends DeploymentBase {
  target: 'cloudflare';
  /** Server config (no port — platform-managed, but cors/csp/cookies apply). */
  server?: ServerDefaults;
  /** Wrangler configuration. */
  wrangler?: WranglerConfig;
}

export interface BrowserDeployment extends DeploymentBase {
  target: 'browser';
  /** No server — browser bundles are client-side. */
}

export interface SdkDeployment extends DeploymentBase {
  target: 'sdk';
  /** No server — SDK is a library. */
}

// ============================================
// MCPB Deployment (MCP Bundle)
// ============================================

export interface McpbAuthor {
  name: string;
  email?: string;
  url?: string;
}

export type McpbUserConfigType = 'string' | 'number' | 'boolean' | 'directory' | 'file';

export interface McpbUserConfigEntry {
  type: McpbUserConfigType;
  title: string;
  description?: string;
  required?: boolean;
  default?: string | number | boolean;
  multiple?: boolean;
  sensitive?: boolean;
  min?: number;
  max?: number;
}

export interface McpbCompatibility {
  /** Semver range for Claude Desktop (e.g., ">=1.0.0"). */
  claude_desktop?: string;
  /** Supported platforms. */
  platforms?: Array<'darwin' | 'win32' | 'linux'>;
  /** Runtime version constraints. */
  runtimes?: {
    node?: string;
    python?: string;
  };
}

export type McpbRepository = string | { type: string; url: string };

export interface McpbDeployment extends DeploymentBase {
  target: 'mcpb';
  /** Human-friendly display name. */
  displayName?: string;
  /** Long markdown description. */
  longDescription?: string;
  /** Author object — overrides parsed package.json.author. */
  author?: McpbAuthor;
  /** SPDX license identifier — overrides package.json.license. */
  license?: string;
  /** Project homepage URL. */
  homepage?: string;
  /** Source repository. */
  repository?: McpbRepository;
  /** Documentation URL. */
  documentation?: string;
  /** Support URL (issues/contact). */
  support?: string;
  /** Path to icon (PNG) relative to project root. */
  icon?: string;
  /** Keywords for search. */
  keywords?: string[];
  /** Privacy policy URLs. */
  privacyPolicies?: string[];
  /** Runtime/platform compatibility constraints. */
  compatibility?: McpbCompatibility;
  /** User-configurable inputs (injected as env vars). */
  userConfig?: Record<string, McpbUserConfigEntry>;
  /** Single-executable binary integration. */
  sea?: {
    /** Build SEA binary for host platform. */
    enabled?: boolean;
    /** Directory of pre-built cross-platform SEA binaries to merge. */
    mergeFrom?: string;
  };
  /** Include node_modules/ in archive (opt-in). */
  includeNodeModules?: boolean;
  /** Deterministic archive output. @default true */
  deterministic?: boolean;
}

export type DeploymentTarget =
  | NodeDeployment
  | DistributedDeployment
  | CliDeployment
  | VercelDeployment
  | LambdaDeployment
  | CloudflareDeployment
  | BrowserDeployment
  | SdkDeployment
  | McpbDeployment;

// ============================================
// CLI extension (issue #409)
// ============================================

/** Positional argument for a project-defined command. */
export interface ProjectCommandArgument {
  /** Argument name (kebab-case). Shown in --help. */
  name: string;
  /** Required (`<name>`) vs optional (`[name]`). @default false */
  required?: boolean;
  /** One-line description. */
  description?: string;
  /** Variadic (`<name...>`/`[name...]`). @default false */
  variadic?: boolean;
}

/** Named option for a project-defined command. */
export interface ProjectCommandOption {
  /** Commander flag spec, e.g. `-f, --force` or `-p, --port <num>`. */
  flags: string;
  /** One-line description. */
  description?: string;
  /** Default value forwarded to Commander. */
  default?: string | number | boolean;
}

/** A single project-defined CLI command. */
export interface ProjectCommandEntry {
  /** Path to the runner module (TS or JS), relative to project root. */
  entry: string;
  /** One-line description shown under "Project commands" in --help. */
  description?: string;
  /** Positional arguments. */
  arguments?: ProjectCommandArgument[];
  /** Named options. */
  options?: ProjectCommandOption[];
  /** Hide from --help. Verb is still invokable. @default false */
  hidden?: boolean;
}

/** CLI extension block — see `cli.commands` in frontmcp.config. */
export interface CliExtensionConfig {
  /**
   * Map of verb name → command definition. Verb names may include `:`,
   * `_`, and `-` (e.g. `project:init`, `db-migrate`). Reserved verbs (the
   * built-in ones) are rejected at config-load time.
   */
  commands?: Record<string, ProjectCommandEntry>;
}

// ============================================
// Top-Level Config
// ============================================

// ============================================
// Transport defaults (issue #400)
// ============================================

/**
 * Per-protocol defaults consumed by `dev` / `inspector` / `pm start` /
 * `pm socket` so server-startup flags don't have to be re-typed on every
 * CLI invocation.
 */
export interface TransportConfig {
  /** Default protocol when no flag is set. */
  default?: 'http' | 'sse' | 'stdio';
  /** HTTP transport defaults — overridden by `--port` / per-deployment `server.http.port`. */
  http?: {
    /** Default HTTP port. */
    port?: number;
    /** Mount path (e.g., '/mcp'). */
    path?: string;
    /** Bind address. */
    host?: string;
  };
  /** Stdio transport defaults — used by `inspector` to spawn the server. */
  stdio?: {
    command?: string;
    args?: string[];
  };
}

// ============================================
// Env overlays (issue #400)
// ============================================

/**
 * Top-level env overlays. `shared` applies everywhere; mode-specific
 * overlays (`dev`, `test`, `ship`) are merged on top of `shared`.
 *
 * Effective env = `shared` ⊕ `<mode>` (later wins). `.env` / `.env.local`
 * files still load and take precedence over config overlays (parity with
 * existing `dev` behavior).
 */
export interface EnvOverlays {
  shared?: Record<string, string>;
  dev?: Record<string, string>;
  test?: Record<string, string>;
  ship?: Record<string, string>;
}

// ============================================
// MCP client connection snippets (issue #400)
// ============================================

export type McpClientName = 'claude-code' | 'claude-desktop' | 'cursor' | 'windsurf' | 'vscode';

export interface ClientConnection {
  /** Display name. Defaults to the top-level `name` field. */
  name?: string;
  /** Transport protocol. */
  transport: 'http' | 'sse' | 'stdio';
  /** Spawn command (for `stdio` transport). */
  command?: string;
  /** Spawn args (for `stdio` transport). */
  args?: string[];
  /** Env vars to set on the spawned client. */
  env?: Record<string, string>;
  /** Server URL (for `http` / `sse` transport). */
  url?: string;
}

/**
 * Per-client connection descriptors consumed by `frontmcp eject-mcp-config
 * <client>` to emit ready-to-paste `.mcp.json` /
 * `claude_desktop_config.json` / Cursor / Windsurf / VS Code snippets.
 */
export type ClientsConfig = Partial<Record<McpClientName, ClientConnection>>;

// ============================================
// Test runner defaults (issue #400)
// ============================================

/**
 * `frontmcp test` defaults. CLI flags (`--timeout`, `--runInBand`,
 * `--coverage`, positional test patterns) override these.
 */
export interface TestConfig {
  timeoutMs?: number;
  runInBand?: boolean;
  testMatch?: string[];
  coverage?: boolean;
}

// ============================================
// Skills install / export defaults (issue #400)
// ============================================

/**
 * `frontmcp skills install` / `export` defaults. `install` is the list of
 * catalog skill names a project depends on so `frontmcp skills install`
 * with no arguments installs the curated set.
 */
export interface SkillsCliConfig {
  provider?: 'claude' | 'codex';
  bundle?: 'recommended' | 'minimal' | 'full' | 'none';
  install?: string[];
  exportTarget?: 'cursor' | 'windsurf' | 'copilot';
}

// ============================================
// Top-level config
// ============================================

export interface FrontMcpConfig {
  /** JSON Schema pointer for IDE autocomplete. */
  $schema?: string;
  /** Server name (alphanumeric, .-_ allowed). */
  name: string;
  /** Server version (semver). @default '1.0.0' */
  version?: string;
  /** Entry point file path. */
  entry?: string;
  /** Node.js version requirement. @default '>=22.0.0' */
  nodeVersion?: string;
  /** Build targets — server config lives inside each target that needs it. */
  deployments: DeploymentTarget[];
  /** Build/bundler options. */
  build?: BuildOptions;
  /** Project-defined CLI extensions (issue #409). */
  cli?: CliExtensionConfig;

  // Issue #400 — config drives every command, not just `build`
  /** Transport defaults consumed by `dev` / `inspector` / `pm start` / `pm socket`. */
  transport?: TransportConfig;
  /** Env overlays merged in addition to `.env` / `.env.local`. */
  env?: EnvOverlays;
  /** Per-client snippets emitted by `frontmcp eject-mcp-config <client>`. */
  clients?: ClientsConfig;
  /** `frontmcp test` defaults overridden by CLI flags. */
  test?: TestConfig;
  /** `frontmcp skills install` / `export` defaults. */
  skills?: SkillsCliConfig;
}
