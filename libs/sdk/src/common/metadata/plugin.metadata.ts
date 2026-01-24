import { RawZodShape } from '../types';
import { z } from 'zod';
import { Token } from '@frontmcp/di';
import { ProviderType, PluginType, AdapterType, ToolType, ResourceType, PromptType, SkillType } from '../interfaces';
import {
  annotatedFrontMcpAdaptersSchema,
  annotatedFrontMcpPluginsSchema,
  annotatedFrontMcpPromptsSchema,
  annotatedFrontMcpProvidersSchema,
  annotatedFrontMcpResourcesSchema,
  annotatedFrontMcpSkillsSchema,
  annotatedFrontMcpToolsSchema,
} from '../schemas';

/**
 * Context extension declaration for plugins.
 * Allows plugins to add properties to ExecutionContextBase (ToolContext, etc.)
 * without directly accessing SDK internals.
 *
 * @example
 * ```typescript
 * @Plugin({
 *   name: 'remember',
 *   contextExtensions: [
 *     { property: 'remember', token: RememberAccessorToken },
 *     { property: 'approval', token: ApprovalServiceToken },
 *   ],
 * })
 * ```
 */
export interface ContextExtension {
  /**
   * Property name to add to ExecutionContextBase (e.g., 'remember', 'approval').
   * Will be accessible as `this.remember` in tools.
   */
  property: string;

  /**
   * DI token to resolve when the property is accessed.
   * The resolved value is returned when accessing `this.{property}`.
   */
  token: Token<unknown>;

  /**
   * Custom error message when the token cannot be resolved.
   * Default: "{PluginName} is not installed or {property} is not configured."
   */
  errorMessage?: string;
}

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
   * Plugin-scoped Skills that teach AI how to perform multi-step tasks.
   * Skills are workflow guides that combine tools into coherent recipes.
   * They can be discovered via searchSkills and loaded via loadSkill.
   */
  skills?: SkillType[];

  /**
   * Determines where plugin hooks are registered:
   * - 'app' (default): Hooks fire only for requests to this app
   * - 'server': Hooks fire at gateway level for all apps
   *
   * Note: Plugins with scope='server' cannot be used in standalone apps.
   */
  scope?: 'app' | 'server';

  /**
   * Context extensions to add to ExecutionContextBase.
   * Allows plugins to provide `this.{property}` access in tools.
   *
   * @example
   * ```typescript
   * @Plugin({
   *   name: 'remember',
   *   contextExtensions: [
   *     { property: 'remember', token: RememberAccessorToken },
   *   ],
   * })
   * ```
   */
  contextExtensions?: ContextExtension[];
}

// Schema for context extensions (uses passthrough since token is a Symbol)
const contextExtensionSchema = z
  .object({
    property: z.string().min(1),
    token: z.any(), // Token is a Symbol, can't validate with zod
    errorMessage: z.string().optional(),
  })
  .passthrough();

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
    skills: z.array(annotatedFrontMcpSkillsSchema).optional(),
    scope: z.enum(['app', 'server']).optional().default('app'),
    contextExtensions: z.array(contextExtensionSchema).optional(),
  } satisfies RawZodShape<PluginMetadata>)
  .passthrough();
