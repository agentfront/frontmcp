import type { JSONSchema } from 'zod/v4/core';

/** JSON Schema type from Zod v4 */
type JsonSchema = JSONSchema.JSONSchema;
import type { OpenAPIV3, OpenAPIV3_1 } from 'openapi-types';

/**
 * OpenAPI specification version 3.0.x or 3.1.x
 */
export type OpenAPIVersion = '3.0.0' | '3.0.1' | '3.0.2' | '3.0.3' | '3.1.0';

/**
 * Unified OpenAPI Document type (supports both 3.0 and 3.1)
 */
export type OpenAPIDocument = OpenAPIV3.Document | OpenAPIV3_1.Document;

/**
 * HTTP methods supported by OpenAPI
 */
export type HTTPMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options' | 'trace';

/**
 * Parameter location types
 */
export type ParameterLocation = 'path' | 'query' | 'header' | 'cookie' | 'body';

/**
 * Authentication types supported
 */
export type AuthType = 'apiKey' | 'http' | 'oauth2' | 'openIdConnect' | 'mutualTLS';

// Re-export OpenAPI types for convenience
export type OperationObject = OpenAPIV3.OperationObject | OpenAPIV3_1.OperationObject;
export type ParameterObject = OpenAPIV3.ParameterObject | OpenAPIV3_1.ParameterObject;
export type RequestBodyObject = OpenAPIV3.RequestBodyObject | OpenAPIV3_1.RequestBodyObject;
export type ResponseObject = OpenAPIV3.ResponseObject | OpenAPIV3_1.ResponseObject;
export type ResponsesObject = OpenAPIV3.ResponsesObject | OpenAPIV3_1.ResponsesObject;
export type MediaTypeObject = OpenAPIV3.MediaTypeObject | OpenAPIV3_1.MediaTypeObject;
export type HeaderObject = OpenAPIV3.HeaderObject | OpenAPIV3_1.HeaderObject;
export type ExampleObject = OpenAPIV3.ExampleObject | OpenAPIV3_1.ExampleObject;
export type PathItemObject = OpenAPIV3.PathItemObject | OpenAPIV3_1.PathItemObject;
export type PathsObject = OpenAPIV3.PathsObject | OpenAPIV3_1.PathsObject;
export type ServerObject = OpenAPIV3.ServerObject | OpenAPIV3_1.ServerObject;
export type SecuritySchemeObject = OpenAPIV3.SecuritySchemeObject | OpenAPIV3_1.SecuritySchemeObject;
export type ReferenceObject = OpenAPIV3.ReferenceObject | OpenAPIV3_1.ReferenceObject;
export type TagObject = OpenAPIV3.TagObject | OpenAPIV3_1.TagObject;
export type ExternalDocumentationObject =
  | OpenAPIV3.ExternalDocumentationObject
  | OpenAPIV3_1.ExternalDocumentationObject;
export type ServerVariableObject = OpenAPIV3.ServerVariableObject | OpenAPIV3_1.ServerVariableObject;
export type EncodingObject = OpenAPIV3.EncodingObject | OpenAPIV3_1.EncodingObject;
export type SecurityRequirementObject = OpenAPIV3.SecurityRequirementObject | OpenAPIV3_1.SecurityRequirementObject;
export type SchemaObject = OpenAPIV3.SchemaObject | OpenAPIV3_1.SchemaObject;

/**
 * Helper to check if an object is a ReferenceObject
 */
export function isReferenceObject(obj: any): obj is ReferenceObject {
  return obj && typeof obj === 'object' && '$ref' in obj;
}

/**
 * Convert OpenAPI schema to JsonSchema
 * Note: OpenAPI 3.0 uses a subset of JSON Schema Draft 4
 * OpenAPI 3.1 uses JSON Schema Draft 2020-12
 */
export function toJsonSchema(schema: SchemaObject | ReferenceObject): JsonSchema {
  if (isReferenceObject(schema)) {
    return { $ref: schema.$ref } as JsonSchema;
  }

  // Handle OpenAPI 3.0 boolean exclusiveMaximum/exclusiveMinimum
  // by converting them to JSON Schema Draft 7 numeric format
  const { exclusiveMaximum, exclusiveMinimum, maximum, minimum, ...rest } = schema;

  const result: Record<string, unknown> = { ...rest };

  // Handle exclusiveMaximum conversion
  if (typeof exclusiveMaximum === 'boolean') {
    if (exclusiveMaximum && maximum !== undefined) {
      // true + maximum present -> convert to numeric exclusiveMaximum
      result['exclusiveMaximum'] = maximum;
    } else if (maximum !== undefined) {
      // false or true without maximum -> keep maximum only
      result['maximum'] = maximum;
    }
    // Boolean exclusiveMaximum is never added (invalid in JSON Schema 7)
  } else if (exclusiveMaximum !== undefined) {
    // Already numeric (OpenAPI 3.1) - keep as is
    result['exclusiveMaximum'] = exclusiveMaximum;
    if (maximum !== undefined) {
      result['maximum'] = maximum;
    }
  } else if (maximum !== undefined) {
    // No exclusiveMaximum, just maximum
    result['maximum'] = maximum;
  }

  // Handle exclusiveMinimum conversion
  if (typeof exclusiveMinimum === 'boolean') {
    if (exclusiveMinimum && minimum !== undefined) {
      // true + minimum present -> convert to numeric exclusiveMinimum
      result['exclusiveMinimum'] = minimum;
    } else if (minimum !== undefined) {
      // false or true without minimum -> keep minimum only
      result['minimum'] = minimum;
    }
    // Boolean exclusiveMinimum is never added (invalid in JSON Schema 7)
  } else if (exclusiveMinimum !== undefined) {
    // Already numeric (OpenAPI 3.1) - keep as is
    result['exclusiveMinimum'] = exclusiveMinimum;
    if (minimum !== undefined) {
      result['minimum'] = minimum;
    }
  } else if (minimum !== undefined) {
    // No exclusiveMinimum, just minimum
    result['minimum'] = minimum;
  }

  // Recursively convert nested schemas to ensure all nested schemas are valid JsonSchema
  if (result['properties'] && typeof result['properties'] === 'object') {
    const props: Record<string, JsonSchema> = {};
    for (const [key, value] of Object.entries(result['properties'] as Record<string, SchemaObject | ReferenceObject>)) {
      props[key] = toJsonSchema(value);
    }
    result['properties'] = props;
  }

  if (result['items']) {
    if (Array.isArray(result['items'])) {
      result['items'] = (result['items'] as (SchemaObject | ReferenceObject)[]).map(toJsonSchema);
    } else {
      result['items'] = toJsonSchema(result['items'] as SchemaObject | ReferenceObject);
    }
  }

  if (result['additionalProperties'] && typeof result['additionalProperties'] === 'object') {
    result['additionalProperties'] = toJsonSchema(result['additionalProperties'] as SchemaObject | ReferenceObject);
  }

  for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
    if (result[key] && Array.isArray(result[key])) {
      result[key] = (result[key] as (SchemaObject | ReferenceObject)[]).map(toJsonSchema);
    }
  }

  if (result['not']) {
    result['not'] = toJsonSchema(result['not'] as SchemaObject | ReferenceObject);
  }

  return result as JsonSchema;
}

/**
 * Main MCP Tool definition generated from OpenAPI
 */
export interface McpOpenAPITool {
  /**
   * Unique tool name (from operationId or generated)
   */
  name: string;

  /**
   * Tool description (from operation summary/description)
   */
  description: string;

  /**
   * Combined input schema including all parameters
   * (path, query, header, cookie, body)
   */
  inputSchema: JsonSchema;

  /**
   * Output schema based on response definitions
   * Can be a union of multiple status codes
   */
  outputSchema?: JsonSchema;

  /**
   * Mapping from input schema properties to actual request parameters
   */
  mapper: ParameterMapper[];

  /**
   * Additional metadata about the tool
   */
  metadata: ToolMetadata;
}

/**
 * Maps input schema properties to their actual request locations
 */
export interface ParameterMapper {
  /**
   * Property name in the input schema
   */
  inputKey: string;

  /**
   * Where this parameter should be placed in the request
   */
  type: ParameterLocation;

  /**
   * Original parameter name (before conflict resolution)
   */
  key: string;

  /**
   * Whether this parameter is required
   */
  required?: boolean;

  /**
   * Parameter style (for path/query parameters)
   */
  style?: string;

  /**
   * Whether to explode arrays/objects
   */
  explode?: boolean;

  /**
   * Custom serialization info
   */
  serialization?: SerializationInfo;

  /**
   * Security scheme information (if this is an auth parameter)
   * This allows frameworks to resolve auth from context, env vars, etc.
   */
  security?: SecurityParameterInfo;
}

/**
 * Serialization information for complex parameters
 */
export interface SerializationInfo {
  /**
   * Content type for body parameters
   */
  contentType?: string;

  /**
   * Encoding rules
   */
  encoding?: Record<string, EncodingObject>;
}

/**
 * Security parameter information for framework-agnostic auth resolution
 */
export interface SecurityParameterInfo {
  /**
   * Security scheme name from OpenAPI (e.g., "BearerAuth")
   */
  scheme: string;

  /**
   * Security type (apiKey, http, oauth2, openIdConnect)
   */
  type: AuthType;

  /**
   * HTTP authentication scheme (for type: "http")
   * e.g., "bearer", "basic"
   */
  httpScheme?: string;

  /**
   * Bearer token format (e.g., "JWT")
   */
  bearerFormat?: string;

  /**
   * Required OAuth2 scopes
   */
  scopes?: string[];

  /**
   * API key parameter name (for type: "apiKey")
   */
  apiKeyName?: string;

  /**
   * API key location (for type: "apiKey")
   */
  apiKeyIn?: 'query' | 'header' | 'cookie';

  /**
   * Description of the security scheme
   */
  description?: string;
}

/**
 * Additional metadata about the generated tool
 */
export interface ToolMetadata {
  /**
   * Original OpenAPI path
   */
  path: string;

  /**
   * HTTP method
   */
  method: HTTPMethod;

  /**
   * Operation ID from OpenAPI
   */
  operationId?: string;

  /**
   * Operation summary from OpenAPI (short description)
   */
  operationSummary?: string;

  /**
   * Operation description from OpenAPI (detailed description)
   */
  operationDescription?: string;

  /**
   * Tags from OpenAPI
   */
  tags?: string[];

  /**
   * Whether operation is deprecated
   */
  deprecated?: boolean;

  /**
   * Security requirements
   */
  security?: SecurityRequirement[];

  /**
   * Server information
   */
  servers?: ServerInfo[];

  /**
   * Response status codes included in output schema
   */
  responseStatusCodes?: number[];

  /**
   * External documentation
   */
  externalDocs?: ExternalDocumentationObject;

  /**
   * FrontMCP extension data from x-frontmcp in the OpenAPI operation.
   * Contains annotations, cache config, codecall config, tags, etc.
   */
  frontmcp?: FrontMcpExtensionData;
}

/**
 * FrontMCP extension data extracted from x-frontmcp in OpenAPI operations.
 * This provides declarative configuration for tools directly in the OpenAPI spec.
 */
export interface FrontMcpExtensionData {
  /**
   * Tool annotations for AI behavior hints.
   */
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };

  /**
   * Cache configuration for response caching.
   */
  cache?: {
    ttl?: number;
    slideWindow?: boolean;
  };

  /**
   * CodeCall-specific configuration.
   */
  codecall?: {
    enabledInCodeCall?: boolean;
    visibleInListTools?: boolean;
  };

  /**
   * Tags/labels for categorization.
   */
  tags?: string[];

  /**
   * If true, hide tool from discovery.
   */
  hideFromDiscovery?: boolean;

  /**
   * Usage examples.
   */
  examples?: Array<{
    description: string;
    input: Record<string, unknown>;
    output?: unknown;
  }>;
}

/**
 * Security requirement definition
 */
export interface SecurityRequirement {
  /**
   * Security scheme name
   */
  scheme: string;

  /**
   * Security type
   */
  type: AuthType;

  /**
   * Scopes required (for OAuth2/OpenID Connect)
   */
  scopes?: string[];

  /**
   * Parameter name (for API key)
   */
  name?: string;

  /**
   * Parameter location (for API key)
   */
  in?: 'query' | 'header' | 'cookie';

  /**
   * HTTP authentication scheme (for type: "http")
   * e.g., "bearer", "basic"
   */
  httpScheme?: string;

  /**
   * Bearer token format (e.g., "JWT")
   */
  bearerFormat?: string;

  /**
   * Description of the security scheme
   */
  description?: string;
}

/**
 * Server information
 */
export interface ServerInfo {
  /**
   * Server URL
   */
  url: string;

  /**
   * Server description
   */
  description?: string;

  /**
   * Server variables
   */
  variables?: Record<string, ServerVariableObject>;
}

/**
 * Options for loading OpenAPI specifications
 */
export interface LoadOptions {
  /**
   * Whether to dereference $refs in schemas
   * @default true
   */
  dereference?: boolean;

  /**
   * Base URL for API requests
   * Overrides servers in OpenAPI spec
   */
  baseUrl?: string;

  /**
   * Custom HTTP headers for loading from URL
   */
  headers?: Record<string, string>;

  /**
   * Request timeout in milliseconds
   * @default 30000
   */
  timeout?: number;

  /**
   * Whether to validate the OpenAPI document
   * @default true
   */
  validate?: boolean;

  /**
   * Whether to follow HTTP redirects
   * @default true
   */
  followRedirects?: boolean;
}

/**
 * Operation object with additional context for filtering
 */
export type OperationWithContext = OperationObject & {
  path: string;
  method: string;
};

/**
 * Options for generating tools
 */
export interface GenerateOptions {
  /**
   * Include only these operation IDs
   */
  includeOperations?: string[];

  /**
   * Exclude these operation IDs
   */
  excludeOperations?: string[];

  /**
   * Custom filter function
   */
  filterFn?: (operation: OperationWithContext) => boolean;

  /**
   * Naming strategy for resolving conflicts
   */
  namingStrategy?: NamingStrategy;

  /**
   * Preferred response status codes (in order of preference)
   * @default [200, 201, 204, 202, 203, 206]
   */
  preferredStatusCodes?: number[];

  /**
   * Whether to include deprecated operations
   * @default false
   */
  includeDeprecated?: boolean;

  /**
   * Whether to include all response codes in output schema
   * If false, only preferred status code is used
   * @default true
   */
  includeAllResponses?: boolean;

  /**
   * Maximum depth for dereferencing schemas
   * @default 10
   */
  maxSchemaDepth?: number;

  /**
   * Whether to include examples in schemas
   * @default false
   */
  includeExamples?: boolean;

  /**
   * Whether to include security requirements as input parameters
   * If false, security is only in mapper (frameworks resolve from context/env/etc.)
   * If true, security is added to inputSchema as explicit parameters
   * @default false
   */
  includeSecurityInInput?: boolean;
}

/**
 * Naming strategy for resolving parameter conflicts
 */
export interface NamingStrategy {
  /**
   * Resolver function for parameter name conflicts
   * @param paramName - Original parameter name
   * @param location - Parameter location
   * @param index - Index of conflicting parameter (0-based)
   * @returns New parameter name
   */
  conflictResolver: (paramName: string, location: ParameterLocation, index: number) => string;

  /**
   * Function to generate tool names
   * @param path - OpenAPI path
   * @param method - HTTP method
   * @param operationId - Operation ID if available
   * @returns Tool name
   */
  toolNameGenerator?: (path: string, method: HTTPMethod, operationId?: string) => string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  /**
   * Whether the document is valid
   */
  valid: boolean;

  /**
   * Validation errors
   */
  errors?: ValidationErrorDetail[];

  /**
   * Validation warnings
   */
  warnings?: ValidationWarning[];
}

/**
 * Validation error detail
 */
export interface ValidationErrorDetail {
  /**
   * Error message
   */
  message: string;

  /**
   * Error path (JSON pointer)
   */
  path?: string;

  /**
   * Error code
   */
  code?: string;
}

/**
 * Validation warning
 */
export interface ValidationWarning {
  /**
   * Warning message
   */
  message: string;

  /**
   * Warning path (JSON pointer)
   */
  path?: string;

  /**
   * Warning code
   */
  code?: string;
}
