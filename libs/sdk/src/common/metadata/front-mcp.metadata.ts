import { z } from 'zod';
import {
  AuthOptions,
  authOptionsSchema,
  ServerInfoOptions,
  serverInfoOptionsSchema,
  httpOptionsSchema,
  loggingOptionsSchema,
  RawZodShape,
  AuthOptionsInput,
  RedisOptionsInput,
  redisOptionsSchema,
  PubsubOptionsInput,
  pubsubOptionsSchema,
  TransportOptionsInput,
  transportOptionsSchema,
  PaginationOptions,
  paginationOptionsSchema,
  HttpOptionsInput,
  LoggingOptionsInput,
  ElicitationOptionsInput,
  elicitationOptionsSchema,
  SkillsConfigOptionsInput,
  skillsConfigOptionsSchema,
  ExtAppsOptionsInput,
  extAppsOptionsSchema,
} from '../types';
import {
  annotatedFrontMcpAppSchema,
  annotatedFrontMcpPluginsSchema,
  annotatedFrontMcpProvidersSchema,
  annotatedFrontMcpResourcesSchema,
  annotatedFrontMcpSkillsSchema,
  annotatedFrontMcpToolsSchema,
} from '../schemas';
import { AppType, PluginType, ProviderType, ResourceType, SkillType, ToolType } from '../interfaces';

export interface FrontMcpBaseMetadata {
  info: ServerInfoOptions;
  apps: AppType[];
  http?: HttpOptionsInput;
  logging?: LoggingOptionsInput;

  serve?: boolean; // default to true

  /**
   * Shared storage configuration
   * Used by transport persistence and auth token storage.
   * Supports both Redis and Vercel KV providers.
   */
  redis?: RedisOptionsInput;

  /**
   * Pub/Sub configuration (Redis-only)
   * Required for resource subscriptions when using Vercel KV for sessions.
   * Falls back to `redis` config if not specified and redis is configured with Redis provider.
   */
  pubsub?: PubsubOptionsInput;

  /**
   * Transport and session lifecycle configuration
   * Controls transport protocols, session management, and persistence
   * @default {} (all transport options use their schema defaults)
   */
  transport?: TransportOptionsInput; // Optional in input, but always defined in output

  /**
   * Additional providers that are available to all apps.
   */
  providers?: ProviderType[];

  /**
   * Shared tools that are available to all apps.
   * These are merged (additively) with app-specific tools.
   */
  tools?: ToolType[];

  /**
   * Shared resources that are available to all apps.
   * These are merged (additively) with app-specific resources.
   */
  resources?: ResourceType[];

  /**
   * Shared skills that are available to all apps.
   * These are merged (additively) with app-specific skills.
   */
  skills?: SkillType[];

  /**
   * Server-level plugins that are instantiated per scope.
   * Each scope gets its own instance of these plugins.
   * These plugins have server-wide access (can see all apps in scope).
   */
  plugins?: PluginType[];

  /**
   * Pagination configuration for list operations.
   * Currently only tool list pagination is supported (tools/list endpoint).
   */
  pagination?: PaginationOptions;

  /**
   * Elicitation configuration.
   * Controls whether tools can request interactive user input during execution.
   * When enabled, tool output schemas are extended to include elicitation fallback response type.
   * @default { enabled: false }
   */
  elicitation?: ElicitationOptionsInput;

  /**
   * Skills HTTP endpoints configuration.
   * Controls exposure of skills via HTTP endpoints for multi-agent architectures.
   *
   * When enabled, provides:
   * - GET /llm.txt - Compact skill summaries
   * - GET /llm_full.txt - Full skills with instructions and tool schemas
   * - GET /skills - JSON API for listing/searching skills
   * - GET /skills/{id} - Load specific skill by ID
   *
   * @default { enabled: false }
   *
   * @example Enable skills HTTP endpoints
   * ```typescript
   * skillsConfig: { enabled: true }
   * ```
   *
   * @example HTTP-only (disable MCP tools)
   * ```typescript
   * skillsConfig: {
   *   enabled: true,
   *   mcpTools: false,  // No searchSkills/loadSkill MCP tools
   * }
   * ```
   */
  skillsConfig?: SkillsConfigOptionsInput;

  /**
   * MCP Apps (ext-apps) configuration.
   * Controls handling of ext-apps widget-to-host communication over HTTP transport.
   *
   * When enabled, the HTTP transport will route `ui/*` JSON-RPC methods
   * (ui/initialize, ui/callServerTool, etc.) through session validation
   * and the ExtAppsMessageHandler.
   *
   * ## Host Capabilities
   *
   * Host capabilities advertise what features the server supports to widgets:
   *
   * | Capability           | Description                                      | Default |
   * |---------------------|--------------------------------------------------|---------|
   * | `serverToolProxy`   | Allow widgets to call MCP tools via ui/callServerTool | `true`  |
   * | `logging`           | Allow widgets to send logs via ui/log            | `true`  |
   * | `openLink`          | Allow widgets to request URL opening via ui/openLink | `false` |
   * | `modelContextUpdate`| Allow widgets to update model context via ui/updateModelContext | `false` |
   * | `widgetTools`       | Allow widgets to register/unregister tools dynamically | `false` |
   * | `displayModes`      | Supported display modes: 'inline', 'fullscreen', 'pip' | `undefined` |
   *
   * @default { enabled: true, hostCapabilities: { serverToolProxy: true, logging: true } }
   *
   * @example Enable ext-apps with default capabilities
   * ```typescript
   * extApps: { enabled: true }
   * ```
   *
   * @example Configure all host capabilities
   * ```typescript
   * extApps: {
   *   enabled: true,
   *   hostCapabilities: {
   *     serverToolProxy: true,    // Widgets can call MCP tools
   *     logging: true,            // Widgets can send logs
   *     openLink: true,           // Widgets can request URL opening
   *     modelContextUpdate: true, // Widgets can update model context
   *     widgetTools: true,        // Widgets can register dynamic tools
   *     displayModes: ['inline', 'fullscreen', 'pip'],
   *   },
   * }
   * ```
   *
   * @example Disable ext-apps
   * ```typescript
   * extApps: { enabled: false }
   * ```
   */
  extApps?: ExtAppsOptionsInput;
}

export const frontMcpBaseSchema = z.object({
  info: serverInfoOptionsSchema,
  providers: z.array(annotatedFrontMcpProvidersSchema).optional().default([]),
  tools: z.array(annotatedFrontMcpToolsSchema).optional().default([]),
  resources: z.array(annotatedFrontMcpResourcesSchema).optional().default([]),
  skills: z.array(annotatedFrontMcpSkillsSchema).optional().default([]),
  plugins: z.array(annotatedFrontMcpPluginsSchema).optional().default([]),
  apps: z.array(annotatedFrontMcpAppSchema),
  serve: z.boolean().optional().default(true),
  http: httpOptionsSchema.optional(),
  redis: redisOptionsSchema.optional(),
  pubsub: pubsubOptionsSchema.optional(),
  transport: transportOptionsSchema.optional().transform((val) => val ?? transportOptionsSchema.parse({})),
  logging: loggingOptionsSchema.optional(),
  pagination: paginationOptionsSchema.optional(),
  elicitation: elicitationOptionsSchema.optional(),
  skillsConfig: skillsConfigOptionsSchema.optional(),
  extApps: extAppsOptionsSchema.optional(),
} satisfies RawZodShape<FrontMcpBaseMetadata>);

export interface FrontMcpMultiAppMetadata extends FrontMcpBaseMetadata {
  splitByApp?: false;
  auth?: AuthOptionsInput;
}

const frontMcpMultiAppSchema = frontMcpBaseSchema.extend({
  splitByApp: z.literal(false).default(false).describe('If true, each app gets its own scope & basePath.'),
  auth: authOptionsSchema.optional().describe("Configures the server's default authentication provider."),
} satisfies RawZodShape<FrontMcpMultiAppMetadata, FrontMcpBaseMetadata>);

export interface FrontMcpSplitByAppMetadata extends FrontMcpBaseMetadata {
  splitByApp: true;
  auth?: never;
}

const frontMcpSplitByAppSchema = frontMcpBaseSchema.extend({
  splitByApp: z.literal(true).describe('If false, apps are grouped under the same scope & basePath.'),
  auth: z.never().optional(),
} satisfies RawZodShape<FrontMcpSplitByAppMetadata, FrontMcpBaseMetadata>);

export type FrontMcpMetadata = FrontMcpMultiAppMetadata | FrontMcpSplitByAppMetadata;

/**
 * Type guard for persistence object shape (simplified - no enabled flag)
 */
function isPersistenceObject(
  value: unknown,
): value is { redis?: unknown; defaultTtlMs?: number } | false | undefined | null {
  if (value === undefined || value === null) return true;
  if (value === false) return true; // Explicitly disabled
  if (typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  // Check optional properties have correct types if present
  if ('defaultTtlMs' in obj && typeof obj['defaultTtlMs'] !== 'number') return false;
  return true;
}

/**
 * Transform function to auto-populate transport.persistence from global redis config.
 * This enables automatic transport session persistence when global redis is configured.
 *
 * New simplified behavior:
 * - `persistence: false` → explicitly disabled
 * - `persistence: { redis?: ... }` → enabled with config
 * - `persistence: undefined` → auto-enable when global redis exists
 *
 * Behavior:
 * - If redis is set AND transport.persistence is not configured → auto-enable with global redis
 * - If transport.persistence is false → respect explicit disable
 * - If transport.persistence.redis is explicitly set → use that config
 * - If transport.persistence is object without redis → use global redis
 */
function applyAutoTransportPersistence<T extends { redis?: unknown; transport?: { persistence?: unknown } }>(
  data: T,
): T {
  // If no global redis config, nothing to auto-enable
  if (!data.redis) return data;

  // Safe access with type guard validation
  const transport = data.transport as { persistence?: unknown } | undefined;
  const rawPersistence = transport?.persistence;

  // Validate persistence shape at runtime (should always pass after Zod validation)
  if (!isPersistenceObject(rawPersistence)) {
    return data; // Invalid shape, don't modify
  }

  // Case 1: persistence explicitly disabled (false) - respect that
  if (rawPersistence === false) {
    return data;
  }

  // Case 2: persistence is an object with explicit redis config - use that
  if (rawPersistence && typeof rawPersistence === 'object' && 'redis' in rawPersistence && rawPersistence.redis) {
    return data;
  }

  // Case 3: persistence is an object without redis - use global redis
  if (rawPersistence && typeof rawPersistence === 'object') {
    return {
      ...data,
      transport: {
        ...transport,
        persistence: {
          ...rawPersistence,
          redis: data.redis,
        },
      },
    };
  }

  // Case 4: persistence not configured at all - auto-enable with global redis
  if (rawPersistence === undefined) {
    return {
      ...data,
      transport: {
        ...transport,
        persistence: {
          redis: data.redis,
        },
      },
    };
  }

  return data;
}

export const frontMcpMetadataSchema = frontMcpMultiAppSchema
  .or(frontMcpSplitByAppSchema)
  .transform(applyAutoTransportPersistence);

export type FrontMcpMultiAppConfig = z.infer<typeof frontMcpMultiAppSchema>;
export type FrontMcpSplitByAppConfig = z.infer<typeof frontMcpSplitByAppSchema>;

/** Output type after zod parsing (with defaults applied) */
export type FrontMcpConfigType = z.infer<typeof frontMcpMetadataSchema>;

/** Input type for FrontMCP configuration (before zod defaults) */
export type FrontMcpConfigInput = z.input<typeof frontMcpMetadataSchema>;

export interface AppScopeMetadata extends Omit<FrontMcpSplitByAppMetadata, 'auth' | 'splitByApp'> {
  id: string;
  apps: [AppType];
  auth?: AuthOptions;
}

export interface MultiAppScopeMetadata extends FrontMcpMultiAppMetadata {
  id: string;
  apps: AppType[];
}

export type ScopeMetadata = AppScopeMetadata | MultiAppScopeMetadata;
