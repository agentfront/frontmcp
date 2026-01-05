import { z } from 'zod';
import { isValidMcpUri } from '@frontmcp/utils';
import { RawZodShape, authOptionsSchema, AuthOptionsInput } from '../types';
import {
  AgentType,
  ProviderType,
  PromptType,
  ResourceType,
  ToolType,
  AuthProviderType,
  PluginType,
  AdapterType,
} from '../interfaces';
import {
  annotatedFrontMcpAdaptersSchema,
  annotatedFrontMcpAuthProvidersSchema,
  annotatedFrontMcpPluginsSchema,
  annotatedFrontMcpPromptsSchema,
  annotatedFrontMcpProvidersSchema,
  annotatedFrontMcpResourcesSchema,
  annotatedFrontMcpToolsSchema,
  annotatedFrontMcpAgentsSchema,
} from '../schemas';

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
   * If true, the app will NOT be included and will act as a separated scope.
   * If false, the app will be included in MultiApp frontmcp server.
   * If 'includeInParent', the app will be included in the gateway's
   *    standalone app list and will act as a separated scope under the appName prefix
   */
  standalone: 'includeInParent' | boolean;
}

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

export const frontMcpRemoteAppMetadataSchema = z.looseObject({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  urlType: z.enum(['worker', 'url', 'npm', 'esm']),
  url: z.string().refine(isValidMcpUri, {
    message: 'URL must have a valid scheme (e.g., https://, file://, custom://)',
  }),
  namespace: z.string().optional(),
  transportOptions: remoteTransportOptionsSchema.optional(),
  remoteAuth: remoteAuthConfigSchema.optional(),
  auth: authOptionsSchema.optional(),
  refreshInterval: z.number().optional(),
  standalone: z
    .union([z.literal('includeInParent'), z.boolean()])
    .optional()
    .default(false),
} satisfies RawZodShape<RemoteAppMetadata>);

export type AppMetadata = LocalAppMetadata | RemoteAppMetadata;
