/**
 * Configuration types for the `create()` factory function.
 *
 * Provides a flat config interface that combines server-level and app-level
 * fields, avoiding the need for decorators or explicit app class definitions.
 */

import type {
  AdapterType,
  AgentType,
  AuthProviderType,
  JobType,
  PluginType,
  PromptType,
  ProviderType,
  ResourceType,
  SkillType,
  ToolType,
  WorkflowType,
} from '../common/interfaces';
import type { FrontMcpConfigInput } from '../common/metadata';
import type { AuthOptionsInput } from '../common/types';
import type { DirectServerOptions } from './direct.types';

/** The `@FrontMcp` options of a server whose apps share one endpoint, as `FrontMcpInstance.createDirect()` takes them. */
type ServerConfigInput = Extract<FrontMcpConfigInput, { splitByApp?: false }>;

/**
 * `@FrontMcp` options `create()` sets itself (`apps`, `serve`, `splitByApp`), takes for its synthetic app instead, or
 * that an in-process server has no use for.
 */
type CreateOwnedServerOptions =
  | 'apps'
  | 'serve'
  | 'splitByApp'
  | 'http'
  | '__sourceDir'
  | 'tools'
  | 'resources'
  | 'skills'
  | 'plugins'
  | 'adapters'
  | 'providers'
  | 'auth';

/**
 * Flat configuration for the `create()` factory function.
 *
 * Takes every `@FrontMcp` server option (info, redis, transport, fetch, ui, authorities, instructions, ...) with the
 * app-level entries (tools, resources, prompts, etc.) in a single object.
 * Internally, app-level fields are wrapped into a synthetic app definition.
 *
 * @example
 * ```typescript
 * import { create } from '@frontmcp/sdk';
 *
 * const server = await create({
 *   info: { name: 'my-service', version: '1.0.0' },
 *   tools: [MyTool],
 *   adapters: [OpenapiAdapter.init({ name: 'api', spec, baseUrl })],
 *   machineId: 'stable-id',
 *   cacheKey: 'tenant-123',
 * });
 * ```
 */
export interface CreateConfig extends Omit<ServerConfigInput, CreateOwnedServerOptions>, DirectServerOptions {
  // ── App-level fields ─────────────────────────────────────────────────

  /** Tool classes or builder-defined tools */
  tools?: ToolType[];

  /** Resource classes or builder-defined resources */
  resources?: ResourceType[];

  /** Prompt classes or builder-defined prompts */
  prompts?: PromptType[];

  /** Adapter instances (e.g., OpenapiAdapter.init({...})) */
  adapters?: AdapterType[];

  /** Plugin instances */
  plugins?: PluginType[];

  /** Dependency injection providers */
  providers?: ProviderType[];

  /** Auth providers (e.g., GithubAuthProvider, GoogleAuthProvider) */
  authProviders?: AuthProviderType[];

  /** Autonomous AI agents */
  agents?: AgentType[];

  /** Skills for multi-step task workflows */
  skills?: SkillType[];

  /** Authentication configuration for the app */
  auth?: AuthOptionsInput;

  /** Job definitions for the app */
  jobDefinitions?: JobType[];

  /** Workflow definitions for the app */
  workflowDefinitions?: WorkflowType[];

  // ── create()-specific fields ─────────────────────────────────────────

  /**
   * Name for the synthetic app.
   * Defaults to `info.name` if not provided.
   */
  appName?: string;

  /**
   * Process-wide machine ID override for session continuity.
   * When set, `getMachineId()` returns this value instead of the computed one.
   * Useful for maintaining sessions across process restarts with Redis storage.
   */
  machineId?: string;

  /**
   * Cache key for reusing server instances.
   * Same `cacheKey` returns the same `DirectMcpServer` promise.
   * Calling `dispose()` on the server automatically evicts it from the cache.
   * The cached server keeps the `workerEnv` of the call that created it; pass a call's own bindings with
   * `DirectCallOptions.workerEnv`.
   */
  cacheKey?: string;
}
