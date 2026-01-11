import type { OpenAPIV3, OpenAPIV3_1 } from 'openapi-types';

/**
 * Options for forcing security on OpenAPI operations
 */
export interface ForceSecurityOptions {
  /**
   * Security scheme name to add/override.
   * @default 'BearerAuth'
   */
  schemeName?: string;

  /**
   * Security scheme type.
   * - 'bearer': HTTP Bearer authentication (JWT)
   * - 'apiKey': API Key authentication
   * - 'basic': HTTP Basic authentication
   * @default 'bearer'
   */
  schemeType?: 'bearer' | 'apiKey' | 'basic';

  /**
   * For apiKey type: where to send the API key.
   * @default 'header'
   */
  apiKeyIn?: 'header' | 'query' | 'cookie';

  /**
   * For apiKey type: the name of the header/query/cookie.
   * @default 'X-API-Key'
   */
  apiKeyName?: string;

  /**
   * Apply security only to these operation IDs.
   * If not specified, applies to all operations.
   */
  operations?: string[];

  /**
   * Description for the security scheme.
   */
  description?: string;
}

type OpenAPIDocument = OpenAPIV3.Document | OpenAPIV3_1.Document;
type SecuritySchemeObject = OpenAPIV3.SecuritySchemeObject | OpenAPIV3_1.SecuritySchemeObject;

/**
 * Deep clone an object to avoid mutating the original.
 */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Modify OpenAPI spec to force JWT/Bearer security on operations.
 * Returns a new spec object (does not mutate input).
 *
 * @param spec - Original OpenAPI specification
 * @param options - Security configuration options
 * @returns Modified OpenAPI specification with security applied
 *
 * @example
 * ```typescript
 * import { forceJwtSecurity } from '@frontmcp/adapters/openapi';
 *
 * // Force Bearer auth on all operations
 * const securedSpec = forceJwtSecurity(originalSpec);
 *
 * // Force Bearer auth with custom scheme name
 * const securedSpec = forceJwtSecurity(originalSpec, {
 *   schemeName: 'JWTAuth',
 *   description: 'JWT Bearer token authentication'
 * });
 *
 * // Force auth on specific operations only
 * const securedSpec = forceJwtSecurity(originalSpec, {
 *   operations: ['createUser', 'updateUser', 'deleteUser']
 * });
 *
 * // Force API Key auth
 * const securedSpec = forceJwtSecurity(originalSpec, {
 *   schemeName: 'ApiKeyAuth',
 *   schemeType: 'apiKey',
 *   apiKeyIn: 'header',
 *   apiKeyName: 'X-API-Key'
 * });
 * ```
 */
export function forceJwtSecurity(spec: OpenAPIDocument, options: ForceSecurityOptions = {}): OpenAPIDocument {
  // Clone spec to avoid mutation
  const result = deepClone(spec);

  const {
    schemeName = 'BearerAuth',
    schemeType = 'bearer',
    apiKeyIn = 'header',
    apiKeyName = 'X-API-Key',
    operations,
    description,
  } = options;

  // Ensure components.securitySchemes exists
  if (!result.components) {
    result.components = {};
  }
  if (!result.components.securitySchemes) {
    result.components.securitySchemes = {};
  }

  // Build security scheme based on type
  let securityScheme: SecuritySchemeObject;

  switch (schemeType) {
    case 'bearer':
      securityScheme = {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: description ?? 'JWT Bearer token authentication',
      };
      break;

    case 'apiKey':
      securityScheme = {
        type: 'apiKey',
        in: apiKeyIn,
        name: apiKeyName,
        description: description ?? `API Key authentication via ${apiKeyIn}`,
      };
      break;

    case 'basic':
      securityScheme = {
        type: 'http',
        scheme: 'basic',
        description: description ?? 'HTTP Basic authentication',
      };
      break;

    default:
      throw new Error(`Unsupported scheme type: ${schemeType}`);
  }

  // Add/override the security scheme
  result.components.securitySchemes[schemeName] = securityScheme;

  // Build security requirement
  const securityRequirement: OpenAPIV3.SecurityRequirementObject = {
    [schemeName]: [],
  };

  // Apply security to operations
  if (!result.paths) {
    return result;
  }

  const operationSet = operations ? new Set(operations) : null;

  for (const [, pathItem] of Object.entries(result.paths)) {
    if (!pathItem) continue;

    // HTTP methods that can have operations
    const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

    for (const method of methods) {
      const operation = (pathItem as any)[method] as OpenAPIV3.OperationObject | undefined;
      if (!operation) continue;

      // If operations filter is specified, only apply to matching operationIds
      if (operationSet) {
        if (!operation.operationId || !operationSet.has(operation.operationId)) {
          continue;
        }
      }

      // Add security requirement to operation
      // This overrides any existing security for this operation
      if (!operation.security) {
        operation.security = [];
      }

      // Check if security requirement already exists
      const hasSecurityRequirement = operation.security.some((req) => Object.keys(req).includes(schemeName));

      if (!hasSecurityRequirement) {
        operation.security.push(securityRequirement);
      }
    }
  }

  return result;
}

/**
 * Remove security requirements from specific operations.
 * Returns a new spec object (does not mutate input).
 *
 * @param spec - Original OpenAPI specification
 * @param operations - Operation IDs to remove security from. If not specified, removes from all.
 * @returns Modified OpenAPI specification
 */
export function removeSecurityFromOperations(spec: OpenAPIDocument, operations?: string[]): OpenAPIDocument {
  // Clone spec to avoid mutation
  const result = deepClone(spec);

  if (!result.paths) {
    return result;
  }

  const operationSet = operations ? new Set(operations) : null;

  for (const [, pathItem] of Object.entries(result.paths)) {
    if (!pathItem) continue;

    const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

    for (const method of methods) {
      const operation = (pathItem as any)[method] as OpenAPIV3.OperationObject | undefined;
      if (!operation) continue;

      // If operations filter is specified, only apply to matching operationIds
      if (operationSet) {
        if (!operation.operationId || !operationSet.has(operation.operationId)) {
          continue;
        }
      }

      // Remove security from operation
      operation.security = [];
    }
  }

  return result;
}
