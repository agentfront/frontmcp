import { RawZodShape } from '../types';
import { z } from 'zod';
import { ProviderType, PluginType, AdapterType, ToolType, ResourceType, PromptType } from '../interfaces';
import {
  annotatedFrontMcpAdaptersSchema,
  annotatedFrontMcpPluginsSchema,
  annotatedFrontMcpPromptsSchema,
  annotatedFrontMcpProvidersSchema,
  annotatedFrontMcpResourcesSchema,
  annotatedFrontMcpToolsSchema,
} from '../schemas';

/**
 * Declarative metadata describing what an McpPlugin contributes at app scope.
 */
export interface PluginMetadata {
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
   * Plugin-scoped providers Named singleton (or scoped-singleton) dependencies used by tools/plugins at runtime
   * — e.g., config, database pools, Redis clients, queues, KMS.
   *
   * Resolution is hierarchical (tool → app → gateway). Providers may depend on
   * other providers and are usually initialized lazily on first use.
   */
  providers?: ProviderType[];

  /**
   * Plugin can export providers to be used in the host app or other plugins,
   * e.g. for AuthPlugin can export AuthSession to be used in other plugins / apps.
   *
   * Resolution is hierarchical (tool → app → gateway). Providers may depend on
   * other providers and are usually initialized lazily on first use.
   */
  exports?: ProviderType[];

  /**
   * Plugin-scoped plugins that participate in lifecycle events and can contribute
   * additional capabilities (tools, resources, prompts, providers, adapters).
   * Use plugins to enforce policy, auth, PII reduction, tracing, etc.
   */
  plugins?: PluginType[];

  /**
   * Plugin-scoped Adapters attached to this app that convert external definitions or sources
   * (e.g., OpenAPI, Lambda, Custom) into generated tools/resources/prompts.
   * Common options include include/exclude filters, name prefixes, base URLs,
   * and authentication (often provided by plugins).
   */
  adapters?: AdapterType[];

  /**
   * Plugin-scoped Inline tools authored by this app (via builder or class). These are active
   * actions with input/output schemas that the model can call. Tools generated
   * by adapters do not need to be listed here.
   */
  tools?: ToolType[];

  resources?: ResourceType[];

  prompts?: PromptType[];

  /**
   * Determines where plugin hooks are registered:
   * - 'app' (default): Hooks fire only for requests to this app
   * - 'server': Hooks fire at gateway level for all apps
   *
   * Note: Plugins with scope='server' cannot be used in standalone apps.
   */
  scope?: 'app' | 'server';
}

export const frontMcpPluginMetadataSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    providers: z.array(annotatedFrontMcpProvidersSchema).optional(),
    exports: z.array(annotatedFrontMcpProvidersSchema).optional(),
    plugins: z.array(annotatedFrontMcpPluginsSchema).optional(),
    adapters: z.array(annotatedFrontMcpAdaptersSchema).optional(),
    tools: z.array(annotatedFrontMcpToolsSchema).optional(),
    resources: z.array(annotatedFrontMcpResourcesSchema).optional(),
    prompts: z.array(annotatedFrontMcpPromptsSchema).optional(),
    scope: z.enum(['app', 'server']).optional().default('app'),
  } satisfies RawZodShape<PluginMetadata>)
  .passthrough();
