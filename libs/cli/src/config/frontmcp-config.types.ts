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
  /** Compatibility date. */
  compatibilityDate?: string;
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
  | 'sdk';

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

export type DeploymentTarget =
  | NodeDeployment
  | DistributedDeployment
  | CliDeployment
  | VercelDeployment
  | LambdaDeployment
  | CloudflareDeployment
  | BrowserDeployment
  | SdkDeployment;

// ============================================
// Top-Level Config
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
}
