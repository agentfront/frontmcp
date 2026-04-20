import { z } from '@frontmcp/lazy-zod';
import { isValidMcpUri } from '@frontmcp/utils';

import type {
  AdapterType,
  AgentType,
  AuthProviderType,
  ChannelType,
  JobType,
  PluginType,
  PromptType,
  ProviderType,
  ResourceType,
  SkillType,
  ToolType,
  WorkflowType,
} from '../interfaces';
import {
  annotatedFrontMcpAdaptersSchema,
  annotatedFrontMcpAgentsSchema,
  annotatedFrontMcpAuthProvidersSchema,
  annotatedFrontMcpChannelsSchema,
  annotatedFrontMcpJobsSchema,
  annotatedFrontMcpPluginsSchema,
  annotatedFrontMcpPromptsSchema,
  annotatedFrontMcpProvidersSchema,
  annotatedFrontMcpResourcesSchema,
  annotatedFrontMcpSkillsSchema,
  annotatedFrontMcpToolsSchema,
  annotatedFrontMcpWorkflowsSchema,
} from '../schemas';
import { authOptionsSchema, type AuthOptionsInput, type RawZodShape } from '../types';
import { appFilterConfigSchema, type AppFilterConfig } from './app-filter.metadata';
import { type EsmOptions, type RemoteOptions } from './remote-primitive.metadata';

/**
 * Declarative metadata describing what a local mcp app contributes at app scope.
 *
 * Includes dependency providers, app-scoped plugins, adapters (that can
 * generate tools/resources/prompts from external definitions), and any
 * inline tools authored in the app. Adapter-generated items inherit the
 * app’s plugins and policies and are tagged with provenance.
 */
export interface LocalAppMetadata {
  /**
   * Human-friendly name for this app as shown in UIs, logs, and describe reports.
   * Keep it short, stable, and unique within a gateway (consider prefixes).
   */
  id?: string;
  /**
   * Human-friendly name for this app as shown in UIs, logs, and describe reports.
   * Keep it short, stable, and unique within a gateway (consider prefixes).
   */
  name: string;

  /**
   * Optional longer explanation of what the app does and what it exposes.
   * Used for documentation, describe reports, and UIs. Avoid secrets/PII.
   */
  description?: string;

  /**
   * Named singleton (or scoped-singleton) dependencies used by tools/plugins at runtime
   * — e.g., config, database pools, Redis clients, queues, KMS.
   *
   * Resolution is hierarchical (tool → app → gateway). Providers may depend on
   * other providers and are usually initialized lazily on first use.
   */
  providers?: ProviderType[];

  /**
   * Named singleton / session auth provider to be used by tools/plugins at runtime
   * — e.g., GithubAuthProvider, GoogleAuthProvider, etc.
   *
   * Note: this is different from providers, which are used for calling fetch request
   *     with specific auth context headers.
   *
   * Resolution is hierarchical (tool → app → gateway). Providers may depend on
   * other providers and are usually initialized lazily on first use.
   */
  authProviders?: AuthProviderType[];

  /**
   * App-scoped plugins that participate in lifecycle events and can contribute
   * additional capabilities (tools, resources, prompts, providers, adapters).
   * Use plugins to enforce policy, auth, PII reduction, tracing, etc.
   */
  plugins?: PluginType[];

  /**
   * Adapters attached to this app that convert external definitions or sources
   * (e.g., OpenAPI, Lambda, Custom) into generated tools/resources/prompts.
   * Common options include include/exclude filters, name prefixes, base URLs,
   * and authentication (often provided by plugins).
   */
  adapters?: AdapterType[];

  /**
   * Inline tools authored by this app (via builder or class). These are active
   * actions with input/output schemas that the model can call. Tools generated
   * by adapters do not need to be listed here.
   */
  tools?: ToolType[];
  resources?: ResourceType[];
  prompts?: PromptType[];

  /**
   * Autonomous AI agents with their own LLM providers and isolated scopes.
   * Each agent is automatically exposed as a callable tool with the name
   * `use-agent:<agent_id>`. Agents can have nested tools, resources, prompts,
   * and even other agents.
   */
  agents?: AgentType[];

  /**
   * Skills that teach AI how to perform multi-step tasks using tools.
   * Skills are workflow guides that combine multiple tools into coherent
   * recipes. They can be discovered via the skills://catalog MCP resource
   * and loaded via skills://{skillName} MCP resources.
   */
  skills?: SkillType[];

  /**
   * Jobs registered by this app.
   * Jobs are pure executable units with strict input/output schemas.
   */
  jobs?: JobType[];

  /**
   * Workflows registered by this app.
   * Workflows connect jobs into managed steps with triggers.
   */
  workflows?: WorkflowType[];

  /**
   * Notification channels registered by this app.
   * Channels push real-time events to Claude Code sessions via the
   * `notifications/claude/channel` experimental extension.
   */
  channels?: ChannelType[];

  /**
   * Configures the app's default authentication provider.
   * If not provided, the app will use the gateway's default auth provider.
   */
  auth?: AuthOptionsInput;

  /**
   * If true, the app will NOT be included and will act as a separated scope.
   * If false, the app will be included in MultiApp frontmcp server.
   * If 'includeInParent', the app will be included in the gateway's
   *    standalone app list and will act as a separated scope under the appName prefix
   */
  standalone?: 'includeInParent' | boolean;
}

export const frontMcpLocalAppMetadataSchema = z.looseObject({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  providers: z.array(annotatedFrontMcpProvidersSchema).optional().default([]),
  authProviders: z.array(annotatedFrontMcpAuthProvidersSchema).optional().default([]),
  plugins: z.array(annotatedFrontMcpPluginsSchema).optional(),
  adapters: z.array(annotatedFrontMcpAdaptersSchema).optional(),
  tools: z.array(annotatedFrontMcpToolsSchema).optional(),
  resources: z.array(annotatedFrontMcpResourcesSchema).optional(),
  prompts: z.array(annotatedFrontMcpPromptsSchema).optional(),
  agents: z.array(annotatedFrontMcpAgentsSchema).optional(),
  skills: z.array(annotatedFrontMcpSkillsSchema).optional(),
  jobs: z.array(annotatedFrontMcpJobsSchema).optional(),
  workflows: z.array(annotatedFrontMcpWorkflowsSchema).optional(),
  channels: z.array(annotatedFrontMcpChannelsSchema).optional(),
  auth: authOptionsSchema.optional(),
  standalone: z
    .union([z.literal('includeInParent'), z.boolean()])
    .optional()
    .default(false),
} satisfies RawZodShape<LocalAppMetadata>);

// ═══════════════════════════════════════════════════════════════════
// REMOTE APP TYPES
// ═══════════════════════════════════════════════════════════════════

/**
 * Transport options for remote MCP connections
 */
export interface RemoteTransportOptions {
  /**
   * Request timeout in milliseconds.
   * @default 30000
   */
  timeout?: number;

  /**
   * Number of retry attempts for failed requests.
   * @default 3
   */
  retryAttempts?: number;

  /**
   * Delay between retries in milliseconds.
   * @default 1000
   */
  retryDelayMs?: number;

  /**
   * Whether to fallback to SSE if Streamable HTTP fails.
   * Only applies to 'url' transport type.
   * @default true
   */
  fallbackToSSE?: boolean;

  /**
   * Additional headers to include in all requests.
   */
  headers?: Record<string, string>;
}

/**
 * Static credentials for remote server authentication
 */
export interface RemoteStaticCredentials {
  type: 'bearer' | 'basic' | 'apiKey';
  value: string;
  /**
   * Header name for apiKey type.
   * @default 'X-API-Key'
   */
  headerName?: string;
}

/**
 * Authentication configuration for remote MCP connections.
 * This controls how the gateway authenticates with the remote server.
 */
export type RemoteAuthConfig =
  | {
      /**
       * Use static credentials for the remote server.
       * Good for trusted internal services.
       */
      mode: 'static';
      credentials: RemoteStaticCredentials;
    }
  | {
      /**
       * Forward gateway user's token to remote server.
       * Enables remote authorization decisions based on gateway user.
       */
      mode: 'forward';
      /**
       * Specific claim to extract from token (default: entire token)
       */
      tokenClaim?: string;
      /**
       * Header name to use (default: 'Authorization')
       */
      headerName?: string;
    }
  | {
      /**
       * Let remote server handle its own OAuth flow.
       * No auth headers are added by the gateway.
       */
      mode: 'oauth';
    };

/**
 * Unified loader configuration for npm/ESM package resolution and bundle fetching.
 * When `url` is set but `registryUrl` is not, both registry and bundles use `url`.
 * When `registryUrl` is also set, registry uses `registryUrl`, bundles use `url`.
 */
export interface PackageLoader {
  /** Base URL for the loader server (registry API + bundle fetching).
   *  Defaults: registry → https://registry.npmjs.org, bundles → https://esm.sh */
  url?: string;
  /** Separate registry URL for version resolution (if different from bundle URL) */
  registryUrl?: string;
  /** Bearer token for authentication */
  token?: string;
  /** Env var name containing the bearer token */
  tokenEnvVar?: string;
}

/**
 * Declarative metadata describing what a remote encapsulated mcp app.
 */
export interface RemoteAppMetadata {
  /**
   * Human-friendly name for this app as shown in UIs, logs, and describe reports.
   * Keep it short, stable, and unique within a gateway (consider prefixes).
   */
  id?: string;
  /**
   * Human-friendly name for this app as shown in UIs, logs, and describe reports.
   * Keep it short, stable, and unique within a gateway (consider prefixes).
   */
  name: string;

  /**
   * Optional longer explanation of what the app does and what it exposes.
   * Used for documentation, describe reports, and UIs. Avoid secrets/PII.
   */
  description?: string;

  /**
   * The type of the remote app transport.
   * - 'url': Standard HTTP MCP server (Streamable HTTP with SSE fallback)
   * - 'worker': Local worker subprocess
   * - 'npm': NPM package loaded via esm.sh CDN
   * - 'esm': Direct ESM module URL
   */
  urlType: 'worker' | 'url' | 'npm' | 'esm';

  /**
   * The URL or path for the remote app.
   * - For 'url': HTTP(S) endpoint (e.g., 'https://api.example.com/mcp')
   * - For 'worker': Path to worker script (e.g., './workers/my-mcp.js')
   * - For 'npm': Package specifier (e.g., '@frontmcp/slack-mcp@latest')
   * - For 'esm': ESM module URL (e.g., 'https://esm.sh/@scope/pkg')
   */
  url: string;

  /**
   * Namespace prefix for tools, resources, and prompts from this remote app.
   * Helps avoid naming conflicts when orchestrating multiple remote servers.
   * @default Uses app name
   */
  namespace?: string;

  /**
   * Transport-specific options for the remote connection.
   */
  transportOptions?: RemoteTransportOptions;

  /**
   * Authentication configuration for the remote server.
   * Controls how the gateway authenticates with the remote MCP server.
   */
  remoteAuth?: RemoteAuthConfig;

  /**
   * Configures the app's default authentication provider.
   * If not provided, the app will use the gateway's default auth provider.
   */
  auth?: AuthOptionsInput;

  /**
   * Interval in milliseconds to refresh capabilities from the remote server.
   * Set to 0 to disable automatic refresh.
   * @default 0
   */
  refreshInterval?: number;

  /**
   * TTL in milliseconds for cached capabilities from the remote server.
   * Capabilities are cached to avoid repeated discovery calls.
   * @default 60000 (60 seconds)
   */
  cacheTTL?: number;

  /**
   * ESM/NPM-specific configuration (only used when urlType is 'npm' or 'esm').
   * Configures loader endpoints, auto-update, caching, and import map overrides.
   */
  packageConfig?: {
    /**
     * Unified loader configuration for registry API + bundle fetching.
     * Overrides the gateway-level `loader` when set.
     */
    loader?: PackageLoader;
    /** Auto-update configuration for semver-based polling */
    autoUpdate?: {
      /** Enable background version polling */
      enabled: boolean;
      /** Polling interval in milliseconds (default: 300000 = 5 min) */
      intervalMs?: number;
    };
    /** Local cache TTL in milliseconds (default: 86400000 = 24 hours) */
    cacheTTL?: number;
    /** Import map overrides for ESM resolution */
    importMap?: Record<string, string>;
  };

  /**
   * Include/exclude filter for selectively importing primitives from this app.
   * Supports per-type filtering (tools, resources, prompts, etc.) with glob patterns.
   *
   * @example
   * ```ts
   * { default: 'include', exclude: { tools: ['dangerous-*'] } }
   * { default: 'exclude', include: { tools: ['echo', 'add'] } }
   * ```
   */
  filter?: AppFilterConfig;

  /**
   * If true, the app will NOT be included and will act as a separated scope.
   * If false, the app will be included in MultiApp frontmcp server.
   * If 'includeInParent', the app will be included in the gateway's
   *    standalone app list and will act as a separated scope under the appName prefix
   */
  standalone: 'includeInParent' | boolean;
}

export const packageLoaderSchema = z.object({
  url: z.string().url().optional(),
  registryUrl: z.string().url().optional(),
  token: z.string().min(1).optional(),
  tokenEnvVar: z.string().min(1).optional(),
});

const esmAutoUpdateOptionsSchema = z.object({
  enabled: z.boolean(),
  intervalMs: z.number().positive().optional(),
});

const packageConfigSchema = z.object({
  loader: packageLoaderSchema.optional(),
  autoUpdate: esmAutoUpdateOptionsSchema.optional(),
  cacheTTL: z.number().positive().optional(),
  importMap: z.record(z.string(), z.string()).optional(),
});

const remoteTransportOptionsSchema = z.object({
  timeout: z.number().optional(),
  retryAttempts: z.number().optional(),
  retryDelayMs: z.number().optional(),
  fallbackToSSE: z.boolean().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

const remoteStaticCredentialsSchema = z.object({
  type: z.enum(['bearer', 'basic', 'apiKey']),
  value: z.string(),
  headerName: z.string().optional(),
});

const remoteAuthConfigSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('static'),
    credentials: remoteStaticCredentialsSchema,
  }),
  z.object({
    mode: z.literal('forward'),
    tokenClaim: z.string().optional(),
    headerName: z.string().optional(),
  }),
  z.object({
    mode: z.literal('oauth'),
  }),
]);

export const frontMcpRemoteAppMetadataSchema = z
  .looseObject({
    id: z.string().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    urlType: z.enum(['worker', 'url', 'npm', 'esm']),
    url: z.string().min(1),
    namespace: z.string().optional(),
    transportOptions: remoteTransportOptionsSchema.optional(),
    remoteAuth: remoteAuthConfigSchema.optional(),
    auth: authOptionsSchema.optional(),
    refreshInterval: z.number().optional(),
    cacheTTL: z.number().optional(),
    packageConfig: packageConfigSchema.optional(),
    filter: appFilterConfigSchema.optional(),
    standalone: z
      .union([z.literal('includeInParent'), z.boolean()])
      .optional()
      .default(false),
  } satisfies RawZodShape<RemoteAppMetadata>)
  .refine(
    (data) => {
      // For npm/esm urlTypes, url is a package specifier (no scheme required)
      if (data.urlType === 'npm' || data.urlType === 'esm') return true;
      // For url/worker types, require a valid URI scheme
      return isValidMcpUri(data.url);
    },
    { message: 'URL must have a valid scheme for url/worker types (e.g., https://, file://)' },
  );

export type AppMetadata = LocalAppMetadata | RemoteAppMetadata;

// ═══════════════════════════════════════════════════════════════════
// App.esm() / App.remote() OPTION TYPES
// ═══════════════════════════════════════════════════════════════════

/**
 * Options for `App.esm()` — loads an @App-decorated class from an npm package.
 * Extends {@link EsmOptions} with app-specific fields.
 */
export interface EsmAppOptions extends EsmOptions {
  /** Override the auto-derived app name */
  name?: string;
  /** Namespace prefix for tools, resources, and prompts */
  namespace?: string;
  /** Human-readable description */
  description?: string;
  /** Standalone mode */
  standalone?: boolean | 'includeInParent';
  /** Auto-update configuration for semver-based polling */
  autoUpdate?: { enabled: boolean; intervalMs?: number };
  /** Import map overrides for ESM resolution */
  importMap?: Record<string, string>;
  /** Include/exclude filter for selectively importing primitives */
  filter?: AppFilterConfig;
}

/**
 * Options for `App.remote()` — connects to an external MCP server via HTTP.
 * Extends {@link RemoteOptions} with app-specific fields.
 */
export interface RemoteUrlAppOptions extends RemoteOptions {
  /** Override the auto-derived app name */
  name?: string;
  /** Namespace prefix for tools, resources, and prompts */
  namespace?: string;
  /** Human-readable description */
  description?: string;
  /** Standalone mode */
  standalone?: boolean | 'includeInParent';
  /** Interval (ms) to refresh capabilities from the remote server */
  refreshInterval?: number;
  /** TTL (ms) for cached capabilities */
  cacheTTL?: number;
  /** Include/exclude filter for selectively importing primitives */
  filter?: AppFilterConfig;
}
