import { OpenAPIV3, OpenAPIV3_1 } from 'openapi-types';
import type { LoadOptions, GenerateOptions, McpOpenAPITool, SecurityContext, ToolMetadata } from 'mcp-from-openapi';
import type { FrontMcpLogger, ToolAnnotations, ToolExample, ToolUIConfig, FrontMcpContext } from '@frontmcp/sdk';

// ============================================================================
// Input Transform Types
// ============================================================================

/**
 * Context available when injecting values at request time
 */
export interface InputTransformContext {
  /** FrontMCP request context with authInfo, sessionId, traceId, etc. */
  ctx: FrontMcpContext;
  /** Environment variables */
  env: NodeJS.ProcessEnv;
  /** The OpenAPI tool being executed */
  tool: McpOpenAPITool;
}

/**
 * Single input transform configuration.
 * Removes an input from the schema and injects its value at request time.
 */
export interface InputTransform {
  /**
   * The input key (property name in inputSchema) to transform.
   * This input will be removed from the schema visible to AI/users.
   */
  inputKey: string;

  /**
   * Value injector function called at request time.
   * Returns the value to inject for this input.
   */
  inject: (ctx: InputTransformContext) => unknown | Promise<unknown>;
}

/**
 * Input transform configuration options.
 * Supports global, per-tool, and dynamic transforms.
 */
export interface InputTransformOptions {
  /**
   * Global transforms applied to ALL tools.
   * Use for common patterns like tenant headers.
   */
  global?: InputTransform[];

  /**
   * Per-tool transforms keyed by tool name.
   * These are combined with global transforms.
   */
  perTool?: Record<string, InputTransform[]>;

  /**
   * Dynamic transform generator function.
   * Called for each tool to generate transforms programmatically.
   * Useful when transforms depend on tool metadata.
   */
  generator?: (tool: McpOpenAPITool) => InputTransform[];
}

// ============================================================================
// OpenAPI Extension Types (x-frontmcp)
// ============================================================================

/**
 * The OpenAPI extension key for FrontMCP metadata.
 * Add this to operations in your OpenAPI spec to configure tool behavior.
 *
 * @example OpenAPI YAML
 * ```yaml
 * paths:
 *   /users:
 *     get:
 *       operationId: listUsers
 *       summary: List all users
 *       x-frontmcp:
 *         annotations:
 *           readOnlyHint: true
 *           idempotentHint: true
 *         cache:
 *           ttl: 300
 *         tags:
 *           - users
 * ```
 */
export const FRONTMCP_EXTENSION_KEY = 'x-frontmcp';

/**
 * Cache configuration for tools.
 */
export interface FrontMcpCacheConfig {
  /**
   * Time-to-live in seconds for cached responses.
   */
  ttl?: number;

  /**
   * If true, cache window slides on each access.
   * If false, cache expires at fixed time from first access.
   */
  slideWindow?: boolean;
}

/**
 * CodeCall configuration for tools.
 */
export interface FrontMcpCodeCallConfig {
  /**
   * Whether this tool can be used via CodeCall.
   * @default true
   */
  enabledInCodeCall?: boolean;

  /**
   * If true, this tool stays visible in `list_tools`
   * even when CodeCall is hiding most tools.
   * @default false
   */
  visibleInListTools?: boolean;
}

/**
 * Tool annotations that hint at tool behavior.
 * These map directly to MCP ToolAnnotations.
 */
export interface FrontMcpAnnotations {
  /**
   * A human-readable title for the tool.
   */
  title?: string;

  /**
   * If true, the tool does not modify its environment.
   * @default false
   */
  readOnlyHint?: boolean;

  /**
   * If true, the tool may perform destructive updates.
   * If false, the tool performs only additive updates.
   * (Meaningful only when readOnlyHint == false)
   * @default true
   */
  destructiveHint?: boolean;

  /**
   * If true, calling repeatedly with same args has no additional effect.
   * (Meaningful only when readOnlyHint == false)
   * @default false
   */
  idempotentHint?: boolean;

  /**
   * If true, tool may interact with external entities (open world).
   * If false, tool's domain is closed (e.g., memory tool).
   * @default true
   */
  openWorldHint?: boolean;
}

/**
 * FrontMCP extension schema for OpenAPI operations.
 * Add `x-frontmcp` to any operation to configure tool behavior.
 *
 * @example
 * ```yaml
 * x-frontmcp:
 *   annotations:
 *     readOnlyHint: true
 *     idempotentHint: true
 *   cache:
 *     ttl: 300
 *   codecall:
 *     enabledInCodeCall: true
 *     visibleInListTools: true
 *   tags:
 *     - users
 *     - public-api
 *   hideFromDiscovery: false
 * ```
 */
export interface FrontMcpExtension {
  /**
   * Tool annotations for AI behavior hints.
   */
  annotations?: FrontMcpAnnotations;

  /**
   * Cache configuration for response caching.
   */
  cache?: FrontMcpCacheConfig;

  /**
   * CodeCall-specific configuration.
   */
  codecall?: FrontMcpCodeCallConfig;

  /**
   * Tags/labels for categorization and filtering.
   */
  tags?: string[];

  /**
   * If true, hide tool from discovery/listing.
   * @default false
   */
  hideFromDiscovery?: boolean;

  /**
   * Usage examples for the tool.
   */
  examples?: Array<{
    description: string;
    input: Record<string, unknown>;
    output?: unknown;
  }>;
}

// ============================================================================
// Tool Transform Types
// ============================================================================

/**
 * How to generate tool descriptions from OpenAPI operations.
 * - 'summaryOnly': Use only the operation summary (default, current behavior)
 * - 'descriptionOnly': Use only the operation description
 * - 'combined': Combine summary and description (summary first, then description)
 * - 'full': Include summary, description, and operation ID
 */
export type DescriptionMode = 'summaryOnly' | 'descriptionOnly' | 'combined' | 'full';

/**
 * Transform configuration for modifying generated tools.
 * Can override or augment any tool property.
 */
export interface ToolTransform {
  /**
   * Override or transform the tool name.
   * - string: Replace the name entirely
   * - function: Transform the existing name
   */
  name?: string | ((originalName: string, tool: McpOpenAPITool) => string);

  /**
   * Override or transform the tool description.
   * - string: Replace the description entirely
   * - function: Transform with access to original description and tool metadata
   *
   * @example
   * ```typescript
   * // Combine summary and description
   * description: (original, tool) => {
   *   const summary = tool.metadata.operationSummary || '';
   *   const desc = tool.metadata.operationDescription || '';
   *   return summary && desc ? `${summary}\n\n${desc}` : original;
   * }
   * ```
   */
  description?: string | ((originalDescription: string, tool: McpOpenAPITool) => string);

  /**
   * Annotations to add or merge with existing tool annotations.
   * These hint at tool behavior for AI clients.
   *
   * @example
   * ```typescript
   * annotations: {
   *   readOnlyHint: true,      // Tool doesn't modify state
   *   openWorldHint: true,     // Tool interacts with external systems
   *   destructiveHint: false,  // Tool doesn't delete data
   *   idempotentHint: true,    // Repeated calls have same effect
   * }
   * ```
   */
  annotations?: ToolAnnotations;

  /**
   * UI configuration for the tool (forms, rendering hints).
   */
  ui?: ToolUIConfig;

  /**
   * If true, hide the tool from tool discovery/listing.
   * The tool can still be called directly.
   */
  hideFromDiscovery?: boolean;

  /**
   * Tags to add to the tool for categorization.
   */
  tags?: string[];

  /**
   * Usage examples to add to the tool.
   */
  examples?: ToolExample[];
}

/**
 * Tool transform configuration options.
 * Supports global, per-tool, and dynamic transforms.
 */
export interface ToolTransformOptions {
  /**
   * Global transforms applied to ALL tools.
   * Use for common patterns like adding readOnlyHint to all GET operations.
   */
  global?: ToolTransform;

  /**
   * Per-tool transforms keyed by tool name.
   * Takes precedence over global transforms for overlapping properties.
   */
  perTool?: Record<string, ToolTransform>;

  /**
   * Dynamic transform generator function.
   * Called for each tool to generate transforms programmatically.
   * Useful when transforms depend on tool metadata (e.g., HTTP method).
   *
   * @example
   * ```typescript
   * generator: (tool) => {
   *   // Mark all GET operations as read-only
   *   if (tool.metadata.method === 'get') {
   *     return {
   *       annotations: { readOnlyHint: true, destructiveHint: false },
   *     };
   *   }
   *   // Mark DELETE operations as destructive
   *   if (tool.metadata.method === 'delete') {
   *     return {
   *       annotations: { destructiveHint: true },
   *     };
   *   }
   *   return undefined;
   * }
   * ```
   */
  generator?: (tool: McpOpenAPITool) => ToolTransform | undefined;
}

// ============================================================================
// Output Transform Types
// ============================================================================

/**
 * How to handle output schema in tool description.
 * - 'none': Don't add output schema to description (default)
 * - 'jsonSchema': Append full JSON Schema to description as code block
 * - 'summary': Append human-readable summary of output schema properties
 * - 'compact': Append compact one-line summary (type and main properties)
 */
export type OutputSchemaDescriptionMode = 'none' | 'jsonSchema' | 'summary' | 'compact';

/**
 * JSON Schema type for output transforms.
 */
export type JsonSchemaType = {
  type?: string | string[];
  properties?: Record<string, JsonSchemaType>;
  items?: JsonSchemaType;
  required?: string[];
  title?: string;
  description?: string;
  [key: string]: unknown;
};

/**
 * Context available for pre-tool output transforms (before createOpenApiTool).
 * Applied during fetch() in the adapter to the McpOpenAPITool definitions.
 */
export interface PreToolTransformContext {
  /** The OpenAPI tool being transformed */
  tool: McpOpenAPITool;
  /** Adapter options for reference */
  adapterOptions: OpenApiAdapterOptions;
}

/**
 * Context available for post-tool output transforms (at execution time).
 * Applied after API response is received in createOpenApiTool.
 */
export interface PostToolTransformContext {
  /** FrontMCP request context */
  ctx: FrontMcpContext;
  /** The OpenAPI tool that was executed */
  tool: McpOpenAPITool;
  /** HTTP status code */
  status: number;
  /** Whether response was successful */
  ok: boolean;
  /** Adapter options for reference */
  adapterOptions: OpenApiAdapterOptions;
}

/**
 * Pre-tool output transform - modifies McpOpenAPITool before FrontMCP wrapping.
 * Use for modifying outputSchema, description, or other metadata.
 */
export interface PreToolTransform {
  /**
   * Transform the output schema definition.
   * Return modified schema or undefined to remove the schema.
   */
  transformSchema?: (
    outputSchema: JsonSchemaType | undefined,
    ctx: PreToolTransformContext,
  ) => JsonSchemaType | undefined;

  /**
   * Transform the tool description with output schema info.
   * Return modified description.
   */
  transformDescription?: (
    description: string,
    outputSchema: JsonSchemaType | undefined,
    ctx: PreToolTransformContext,
  ) => string;
}

/**
 * Post-tool output transform - modifies API response at execution time.
 * Use for filtering, reshaping, or enriching response data.
 */
export interface PostToolTransform {
  /**
   * Transform the response data before returning to MCP client.
   * Receives the parsed response and returns transformed response.
   *
   * @param data - Response data from API (or undefined for empty responses)
   * @param ctx - Transform context with request info
   * @returns Transformed data
   */
  transform: (data: unknown, ctx: PostToolTransformContext) => unknown | Promise<unknown>;

  /**
   * Optional filter - if returns false, transform is skipped.
   * Use to apply transform only to specific tools or responses.
   */
  filter?: (ctx: PostToolTransformContext) => boolean;
}

/**
 * Output transform configuration options.
 * Combines built-in modes with custom transform callbacks.
 */
export interface OutputTransformOptions {
  /**
   * Built-in mode for adding output schema to tool description.
   * @default 'none'
   */
  outputSchemaDescriptionMode?: OutputSchemaDescriptionMode;

  /**
   * Custom function to format output schema as human-readable text.
   * Only used when outputSchemaDescriptionMode is 'summary' or 'compact'.
   * If not provided, uses built-in formatters.
   */
  formatOutputSchema?: (schema: JsonSchemaType, mode: 'summary' | 'compact') => string;

  /**
   * Pre-tool output transforms applied to McpOpenAPITool definitions.
   * Applied during fetch() before createOpenApiTool() wrapping.
   */
  preToolTransforms?: {
    /** Global transform applied to all tools */
    global?: PreToolTransform;
    /** Per-tool transforms keyed by tool name */
    perTool?: Record<string, PreToolTransform>;
    /** Dynamic transform generator */
    generator?: (tool: McpOpenAPITool) => PreToolTransform | undefined;
  };

  /**
   * Post-tool output transforms applied to API responses.
   * Applied at execution time after response is received.
   */
  postToolTransforms?: {
    /** Global transform applied to all responses */
    global?: PostToolTransform;
    /** Per-tool transforms keyed by tool name */
    perTool?: Record<string, PostToolTransform>;
    /** Dynamic transform generator */
    generator?: (tool: McpOpenAPITool) => PostToolTransform | undefined;
  };
}

// ============================================================================
// Extended Metadata Types (internal)
// ============================================================================

/**
 * Extended tool metadata that includes adapter-specific fields.
 * This extends the base ToolMetadata from mcp-from-openapi with
 * fields used for transforms and extensions.
 */
export interface ExtendedToolMetadata extends ToolMetadata {
  /**
   * Adapter-specific runtime configuration.
   * Contains transforms and other metadata added during tool processing.
   */
  adapter?: {
    /** Input transforms to apply at request time */
    inputTransforms?: InputTransform[];
    /** Tool transform configuration */
    toolTransform?: ToolTransform;
    /** Security schemes that are included in tool input (user provides) */
    securitySchemesInInput?: string[];
    /** Security schemes resolved from context (authProviderMapper, etc.) */
    securitySchemesFromContext?: string[];
    /** Pre-tool output transform configuration */
    preToolTransform?: PreToolTransform;
    /** Post-tool output transform to apply at runtime */
    postToolTransform?: PostToolTransform;
  };
}

/**
 * McpOpenAPITool with extended metadata type.
 * Use this type when accessing adapter-extended metadata.
 */
export interface ExtendedMcpOpenAPITool extends Omit<McpOpenAPITool, 'metadata'> {
  metadata: ExtendedToolMetadata;
}

interface BaseOptions {
  /**
   * The name of the adapter.
   * This is used to identify the adapter in the MCP configuration.
   * Also used to prefix tools if conflicted with other adapters in the same app.
   */
  name: string;

  /**
   * The base URL of the API.
   * This is used to construct the full URL for each request.
   * For example, if the API is hosted at https://api.example.com/v1,
   * the baseUrl should be set to https://api.example.com/v1.
   * This overrides the baseUrl in LoadOptions.
   */
  baseUrl: string;

  /**
   * Additional headers to be sent with each request.
   * This can be used to set authentication headers,
   * such as Authorization or API Key.
   */
  additionalHeaders?: Record<string, string>;

  /**
   * This can be used to map request information to specific
   * headers as required by the API.
   * For example, mapping tenantId from authenticated session payload to
   * a specific header, this key will be hidden to mcp clients
   * and filled by the adapter before sending the request to the API.
   * @param ctx - FrontMCP request context with authInfo, sessionId, traceId, etc.
   * @param headers
   */
  headersMapper?: (ctx: FrontMcpContext, headers: Headers) => Headers;

  /**
   * This can be used to map request information to specific
   * body values as required by the API.
   * For example, mapping tenantId from authenticated session payload to
   * a specific property in the body, this key will be hidden to mcp clients
   * and filled by the adapter before sending the request to the API.
   *
   * @param ctx - FrontMCP request context with authInfo, sessionId, traceId, etc.
   * @param body
   */
  bodyMapper?: (ctx: FrontMcpContext, body: Record<string, unknown>) => Record<string, unknown>;

  /**
   * Custom security resolver for resolving authentication from context.
   * This allows you to map different auth providers to different tools/security schemes.
   *
   * Use this when:
   * - You have multiple auth providers (e.g., GitHub OAuth, Google OAuth, API keys)
   * - Different tools need different authentication
   * - You need custom logic to select the right auth provider
   *
   * @example
   * ```typescript
   * securityResolver: (tool, ctx) => {
   *   const authInfo = ctx.authInfo;
   *   // Use GitHub token for GitHub API tools
   *   if (tool.name.startsWith('github_')) {
   *     return { jwt: authInfo.user?.githubToken };
   *   }
   *   // Use Google token for Google API tools
   *   if (tool.name.startsWith('google_')) {
   *     return { jwt: authInfo.user?.googleToken };
   *   }
   *   // Default to main JWT token
   *   return { jwt: authInfo.token };
   * }
   * ```
   */
  securityResolver?: (tool: McpOpenAPITool, ctx: FrontMcpContext) => SecurityContext | Promise<SecurityContext>;

  /**
   * Map security scheme names to auth provider extractors.
   * This allows different security schemes to use different auth providers.
   *
   * Use this when your OpenAPI spec has multiple security schemes
   * and each should use a different auth provider from the context.
   *
   * @example
   * ```typescript
   * authProviderMapper: {
   *   // GitHub OAuth security scheme
   *   'GitHubAuth': (ctx) => ctx.authInfo.user?.githubToken,
   *   // Google OAuth security scheme
   *   'GoogleAuth': (ctx) => ctx.authInfo.user?.googleToken,
   *   // API Key security scheme
   *   'ApiKeyAuth': (ctx) => ctx.authInfo.user?.apiKey,
   * }
   * ```
   */
  authProviderMapper?: Record<string, (ctx: FrontMcpContext) => string | undefined>;

  /**
   * Static authentication configuration when not using dynamic auth from context.
   * Useful for server-to-server APIs with static credentials.
   *
   * @example
   * ```typescript
   * staticAuth: {
   *   jwt: process.env.API_JWT_TOKEN,
   *   apiKey: process.env.API_KEY,
   * }
   * ```
   */
  staticAuth?: Partial<SecurityContext>;

  /**
   * Options for loading the OpenAPI specification
   * @see LoadOptions from mcp-from-openapi
   */
  loadOptions?: Omit<LoadOptions, 'baseUrl'>; // baseUrl is in BaseOptions

  /**
   * Options for generating tools from the OpenAPI specification
   * @see GenerateOptions from mcp-from-openapi
   */
  generateOptions?: GenerateOptions;

  /**
   * Specify which security schemes should be included in the tool's input schema.
   * Use this for per-scheme control over authentication handling.
   *
   * - Schemes in this list → included in input (user/AI provides the value)
   * - Schemes NOT in this list → resolved from context (authProviderMapper, staticAuth, etc.)
   *
   * This allows hybrid authentication where some schemes come from user input
   * and others come from the session/context.
   *
   * @example
   * ```typescript
   * // OpenAPI spec has: GitHubAuth (Bearer), ApiKeyAuth (API key)
   * // You want: GitHubAuth from session, ApiKeyAuth from user input
   *
   * const adapter = new OpenapiAdapter({
   *   name: 'my-api',
   *   baseUrl: 'https://api.example.com',
   *   spec: mySpec,
   *
   *   // ApiKeyAuth will be in tool input schema
   *   securitySchemesInInput: ['ApiKeyAuth'],
   *
   *   // GitHubAuth will be resolved from context
   *   authProviderMapper: {
   *     'GitHubAuth': (ctx) => ctx.authInfo?.user?.githubToken,
   *   },
   * });
   * ```
   */
  securitySchemesInInput?: string[];

  /**
   * Input schema transforms for hiding inputs and injecting values at request time.
   *
   * Use cases:
   * - Hide tenant headers from AI/users and inject from session
   * - Hide internal correlation IDs and inject from environment
   * - Remove API-internal fields that should be computed server-side
   *
   * @example
   * ```typescript
   * inputTransforms: {
   *   global: [
   *     { inputKey: 'X-Tenant-Id', inject: (ctx) => ctx.authInfo.user?.tenantId },
   *   ],
   *   perTool: {
   *     'createUser': [
   *       { inputKey: 'createdBy', inject: (ctx) => ctx.authInfo.user?.email },
   *     ],
   *   },
   *   generator: (tool) => {
   *     if (['post', 'put', 'patch'].includes(tool.metadata.method)) {
   *       return [{ inputKey: 'X-Correlation-Id', inject: () => crypto.randomUUID() }];
   *     }
   *     return [];
   *   },
   * }
   * ```
   */
  inputTransforms?: InputTransformOptions;

  /**
   * Tool transforms for modifying generated tools (description, annotations, UI, etc.).
   *
   * Use cases:
   * - Add annotations (readOnlyHint, openWorldHint) based on HTTP method
   * - Override tool descriptions with combined summary + description
   * - Add UI configuration for tool forms
   * - Hide internal tools from discovery
   *
   * @example
   * ```typescript
   * toolTransforms: {
   *   global: {
   *     annotations: { openWorldHint: true },
   *   },
   *   perTool: {
   *     'createUser': {
   *       annotations: { destructiveHint: false },
   *       tags: ['user-management'],
   *     },
   *   },
   *   generator: (tool) => {
   *     if (tool.metadata.method === 'get') {
   *       return { annotations: { readOnlyHint: true } };
   *     }
   *     if (tool.metadata.method === 'delete') {
   *       return { annotations: { destructiveHint: true } };
   *     }
   *     return undefined;
   *   },
   * }
   * ```
   */
  toolTransforms?: ToolTransformOptions;

  /**
   * How to generate tool descriptions from OpenAPI operations.
   * - 'summaryOnly': Use only summary (default)
   * - 'descriptionOnly': Use only description
   * - 'combined': Summary followed by description
   * - 'full': Summary, description, and operation details
   *
   * @default 'summaryOnly'
   */
  descriptionMode?: DescriptionMode;

  /**
   * Output transforms for modifying output schema and response data.
   *
   * Use cases:
   * - Add output schema to tool description for AI understanding
   * - Remove or transform output schema definitions
   * - Transform or filter API responses before returning
   * - Reshape response data for MCP client consumption
   *
   * @example
   * ```typescript
   * outputTransforms: {
   *   // Add human-readable output schema to description for all tools
   *   outputSchemaDescriptionMode: 'summary',
   *
   *   // Custom pre-tool transform to remove schema and add to description
   *   preToolTransforms: {
   *     global: {
   *       transformSchema: () => undefined, // Remove from schema
   *       transformDescription: (desc, schema) =>
   *         schema ? `${desc}\n\nReturns: ${JSON.stringify(schema)}` : desc,
   *     },
   *   },
   *
   *   // Custom post-tool transform to reshape response data
   *   postToolTransforms: {
   *     perTool: {
   *       'listUsers': {
   *         transform: (data) => (data as any)?.users ?? data,
   *       },
   *     },
   *   },
   * }
   * ```
   */
  outputTransforms?: OutputTransformOptions;

  /**
   * Logger instance for adapter diagnostics.
   * Optional - if not provided, the SDK will inject it automatically via setLogger().
   */
  logger?: FrontMcpLogger;

  /**
   * Timeout for HTTP requests in milliseconds.
   * If a request takes longer than this, it will be aborted.
   * @default 30000 (30 seconds)
   */
  requestTimeoutMs?: number;

  /**
   * Maximum request body size in bytes.
   * Requests with bodies larger than this will be rejected before sending.
   * @default 10485760 (10MB)
   */
  maxRequestSize?: number;

  /**
   * Maximum response size in bytes.
   * Responses larger than this will be rejected.
   * The check is performed first on Content-Length header (if present),
   * then on actual response size.
   * @default 10485760 (10MB)
   */
  maxResponseSize?: number;
}

interface SpecOptions extends BaseOptions {
  /**
   * The OpenAPI specification as a JSON object.
   *
   * Accepts:
   * - `OpenAPIV3.Document` (typed)
   * - `OpenAPIV3_1.Document` (typed)
   * - Plain object from `import spec from './openapi.json'`
   *
   * @example
   * ```typescript
   * // From typed constant
   * import { OpenAPIV3 } from 'openapi-types';
   * const spec: OpenAPIV3.Document = { ... };
   * new OpenapiAdapter({ spec, ... })
   *
   * // From JSON import
   * import openapiJson from './my-openapi.json';
   * new OpenapiAdapter({ spec: openapiJson, ... })
   * ```
   */
  spec: OpenAPIV3.Document | OpenAPIV3_1.Document | object;
}

interface UrlOptions extends BaseOptions {
  /**
   * The URL of the OpenAPI specification.
   * Can be a local file path or a remote URL.
   */
  url: string;
}

export type OpenApiAdapterOptions = SpecOptions | UrlOptions;
