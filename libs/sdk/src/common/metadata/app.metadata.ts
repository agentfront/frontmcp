import { z } from 'zod';
import { RawZodShape, AuthOptions, authOptionsSchema } from '../types';
import {
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
} from '../schemas';
import { AgentType, annotatedFrontMcpAgentsSchema } from './agent.metadata';

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
   * `invoke_<agent_id>`. Agents can have nested tools, resources, prompts,
   * and even other agents.
   */
  agents?: AgentType[];

  /**
   * Configures the app's default authentication provider.
   * If not provided, the app will use the gateway's default auth provider.
   */
  auth?: AuthOptions;

  /**
   * If true, the app will NOT be included and will act as a separated scope.
   * If false, the app will be included in MultiApp frontmcp server.
   * If 'includeInParent', the app will be included in the gateway's
   *    standalone app list and will act as a separated scope under the appName prefix
   */
  standalone?: 'includeInParent' | boolean;
}

export const frontMcpLocalAppMetadataSchema = z
  .object({
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
  } satisfies RawZodShape<LocalAppMetadata>)
  .passthrough();

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
   * The type of the remote app.
   * - 'worker': The remote app is a worker file.
   * - 'url': The remote app is a remote URL.
   */
  urlType: 'worker' | 'url';
  /**
   * The URL of the remote app. This can be a local worker file or a remote URL.
   */
  url: string;

  /**
   * Configures the app's default authentication provider.
   * If not provided, the app will use the gateway's default auth provider.
   */
  auth?: AuthOptions;

  /**
   * If true, the app will NOT be included and will act as a separated scope.
   * If false, the app will be included in MultiApp frontmcp server.
   * If 'includeInParent', the app will be included in the gateway's
   *    standalone app list and will act as a separated scope under the appName prefix
   */
  standalone: 'includeInParent' | boolean;
}

export const frontMcpRemoteAppMetadataSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    urlType: z.enum(['worker', 'url']),
    url: z.string().url(),
    auth: authOptionsSchema.optional(),
    standalone: z
      .union([z.literal('includeInParent'), z.boolean()])
      .optional()
      .default(false),
  } satisfies RawZodShape<RemoteAppMetadata>)
  .passthrough();

export type AppMetadata = LocalAppMetadata | RemoteAppMetadata;
