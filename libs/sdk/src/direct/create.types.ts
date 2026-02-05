/**
 * Configuration types for the `create()` factory function.
 *
 * Provides a flat config interface that combines server-level and app-level
 * fields, avoiding the need for decorators or explicit app class definitions.
 */

import type {
  ServerInfoOptions,
  RedisOptionsInput,
  PubsubOptionsInput,
  TransportOptionsInput,
  LoggingOptionsInput,
  PaginationOptions,
  ElicitationOptionsInput,
  SkillsConfigOptionsInput,
  ExtAppsOptionsInput,
  AuthOptionsInput,
} from '../common/types';

import type {
  ToolType,
  ResourceType,
  PromptType,
  PluginType,
  ProviderType,
  AdapterType,
  AgentType,
  SkillType,
  AuthProviderType,
} from '../common/interfaces';

/**
 * Flat configuration for the `create()` factory function.
 *
 * Combines server-level metadata (info, redis, transport, etc.) with
 * app-level entries (tools, resources, prompts, etc.) into a single object.
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
export interface CreateConfig {
  // ── Server-level fields ──────────────────────────────────────────────

  /** Server name and version (required) */
  info: ServerInfoOptions;

  /** Redis configuration for sessions, persistence, etc. */
  redis?: RedisOptionsInput;

  /** Pub/Sub configuration (Redis-only) for resource subscriptions */
  pubsub?: PubsubOptionsInput;

  /** Transport and session lifecycle configuration */
  transport?: TransportOptionsInput;

  /** Logging configuration */
  logging?: LoggingOptionsInput;

  /** Pagination configuration for list operations */
  pagination?: PaginationOptions;

  /** Elicitation configuration for interactive user input */
  elicitation?: ElicitationOptionsInput;

  /** Skills HTTP endpoints configuration */
  skillsConfig?: SkillsConfigOptionsInput;

  /** MCP Apps (ext-apps) configuration */
  extApps?: ExtAppsOptionsInput;

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
   */
  cacheKey?: string;
}
