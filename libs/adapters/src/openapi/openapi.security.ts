import { createSecurityContext, SecurityResolver, type McpOpenAPITool, type SecurityContext } from 'mcp-from-openapi';

import type { FrontMcpContext } from '@frontmcp/sdk';

import type { OpenApiAdapterOptions } from './openapi.types';

/**
 * Security scheme information extracted from OpenAPI spec
 */
export interface SecuritySchemeInfo {
  name: string;
  type: string;
  scheme?: string;
  in?: string;
  description?: string;
}

/**
 * Security validation result
 */
export interface SecurityValidationResult {
  valid: boolean;
  missingMappings: string[];
  warnings: string[];
  securityRiskScore: 'low' | 'medium' | 'high';
}

/**
 * Resolve security context from FrontMCP context with support for multiple auth providers
 *
 * @param tool - OpenAPI tool to resolve security for
 * @param ctx - FrontMCP request context with authInfo, sessionId, traceId, etc.
 * @param options - Adapter options with auth configuration
 * @returns Security context for resolver
 */
export async function createSecurityContextFromAuth(
  tool: McpOpenAPITool,
  ctx: FrontMcpContext,
  options: Pick<
    OpenApiAdapterOptions,
    'securityResolver' | 'authProviderMapper' | 'staticAuth' | 'passthroughCallerToken'
  >,
): Promise<SecurityContext> {
  // 1. Use custom security resolver if provided (highest priority)
  if (options.securityResolver) {
    return await options.securityResolver(tool, ctx);
  }

  // 2. Use auth provider mapper if provided
  if (options.authProviderMapper) {
    const context = createSecurityContext({});

    // Find all security schemes used by this tool
    const securitySchemes = new Set<string>();
    for (const mapper of tool.mapper) {
      if (mapper.security?.scheme) {
        securitySchemes.add(mapper.security.scheme);
      }
    }

    // Map each security scheme to its auth provider
    // Process all schemes - first matching token for each auth type (jwt, apiKey, basic, oauth2Token)
    for (const scheme of securitySchemes) {
      const authExtractor = options.authProviderMapper[scheme];
      if (authExtractor) {
        try {
          const token = authExtractor(ctx);

          // Validate return type - must be string or undefined/null
          if (token !== undefined && token !== null && typeof token !== 'string') {
            throw new Error(
              `authProviderMapper['${scheme}'] must return a string or undefined, ` + `but returned: ${typeof token}`,
            );
          }

          // Reject empty string tokens explicitly - indicates misconfiguration
          if (token === '') {
            throw new Error(
              `authProviderMapper['${scheme}'] returned empty string. ` +
                `Return undefined/null if no token is available, or provide a valid token.`,
            );
          }

          if (token) {
            // Route token to correct context field based on scheme type
            // Look up the scheme info from the mapper to determine type
            const schemeMapper = tool.mapper.find((m) => m.security?.scheme === scheme);
            const schemeType = schemeMapper?.security?.type?.toLowerCase();
            const httpScheme = schemeMapper?.security?.httpScheme?.toLowerCase();

            // Route based on security scheme type (first token for each type wins)
            if (schemeType === 'apikey') {
              if (!context.apiKey) {
                context.apiKey = token;
              }
            } else if (schemeType === 'http' && httpScheme === 'basic') {
              if (!context.basic) {
                context.basic = token;
              }
            } else if (schemeType === 'oauth2') {
              if (!context.oauth2Token) {
                context.oauth2Token = token;
              }
            } else {
              // Default to jwt for http bearer and unknown types
              if (!context.jwt) {
                context.jwt = token;
              }
            }
            // Continue checking other schemes - don't break
            // This allows validation to see all configured providers
          }
        } catch (err) {
          // Re-throw validation errors as-is
          if (err instanceof Error && err.message.includes('authProviderMapper')) {
            throw err;
          }
          // Wrap other errors with context
          const errorMessage = err instanceof Error ? err.message : String(err);
          throw new Error(`authProviderMapper['${scheme}'] threw an error: ${errorMessage}`);
        }
      }
    }

    // If no provider returned a credential, send nothing: the caller's own token is forwarded
    // only when the server opted in with `passthroughCallerToken` (never implicitly).
    const hasAnyAuth = context.jwt || context.apiKey || context.basic || context.oauth2Token;
    if (!hasAnyAuth && options.passthroughCallerToken === true) {
      const callerToken = getCallerToken(ctx);
      if (callerToken) {
        context.jwt = callerToken;
      }
    }

    return context;
  }

  // 3. Use static auth if provided
  if (options.staticAuth) {
    return createSecurityContext(options.staticAuth);
  }

  // 4. No credential source: forward the caller's token only when explicitly enabled.
  // The caller's token was issued for this MCP server, not for the API (token passthrough).
  if (options.passthroughCallerToken === true) {
    return createSecurityContext({ jwt: getCallerToken(ctx) });
  }
  return createSecurityContext({});
}

/**
 * The bearer token the MCP client presented to this server, for `passthroughCallerToken`.
 */
function getCallerToken(ctx: FrontMcpContext): string | undefined {
  const authToken: unknown = ctx.authInfo?.token;
  if (authToken === undefined || authToken === null || authToken === '') {
    return undefined;
  }
  // Validate type before use to prevent non-string values
  if (typeof authToken !== 'string') {
    throw new Error(`authInfo.token must be a string, but got: ${typeof authToken}`);
  }
  return authToken;
}

/**
 * Extract all security schemes used by a set of tools
 *
 * @param tools - OpenAPI tools
 * @returns Set of security scheme names
 */
export function extractSecuritySchemes(tools: McpOpenAPITool[]): Set<string> {
  const schemes = new Set<string>();

  for (const tool of tools) {
    for (const mapper of tool.mapper) {
      if (mapper.security?.scheme) {
        schemes.add(mapper.security.scheme);
      }
    }
  }

  return schemes;
}

/**
 * Validate security configuration against OpenAPI security requirements
 *
 * @param tools - OpenAPI tools
 * @param options - Adapter options
 * @returns Validation result with errors and warnings
 */
export function validateSecurityConfiguration(
  tools: McpOpenAPITool[],
  options: Pick<
    OpenApiAdapterOptions,
    | 'securityResolver'
    | 'authProviderMapper'
    | 'staticAuth'
    | 'generateOptions'
    | 'securitySchemesInInput'
    | 'passthroughCallerToken'
  >,
): SecurityValidationResult {
  const result: SecurityValidationResult = {
    valid: true,
    missingMappings: [],
    warnings: [],
    securityRiskScore: 'low',
  };

  // Extract all security schemes used
  const securitySchemes = extractSecuritySchemes(tools);

  // If includeSecurityInInput is true, auth is provided by user (high security risk)
  const includeSecurityInInput = options.generateOptions?.includeSecurityInInput ?? false;

  if (includeSecurityInInput) {
    result.securityRiskScore = 'high';
    result.warnings.push(
      'SECURITY WARNING: includeSecurityInInput is enabled. Users will provide authentication directly in tool inputs. This increases security risk as credentials may be logged or exposed.',
    );
    // Don't validate mappings if security is in input
    return result;
  }

  // Check if we have custom security resolver (most flexible, low risk)
  if (options.securityResolver) {
    result.securityRiskScore = 'low';
    result.warnings.push(
      'INFO: Using custom securityResolver. Ensure your resolver properly validates and secures credentials from context.',
    );
    return result;
  }

  // Check if we have static auth (medium risk - static credentials)
  if (options.staticAuth && Object.keys(options.staticAuth).length > 0) {
    result.securityRiskScore = 'medium';
    result.warnings.push(
      'SECURITY INFO: Using staticAuth with hardcoded credentials. Ensure credentials are stored securely (environment variables, secrets manager).',
    );
    // If static auth is provided, assume it covers all schemes
    return withPassthroughRisk(result, securitySchemes, options);
  }

  // Get schemes that will be provided via input (don't need mapping)
  const schemesInInput = new Set(options.securitySchemesInInput || []);

  // Check authProviderMapper (low risk - context-based auth)
  if (options.authProviderMapper || schemesInInput.size > 0) {
    result.securityRiskScore = schemesInInput.size > 0 ? 'medium' : 'low';

    // Log info about per-scheme control
    if (schemesInInput.size > 0) {
      result.warnings.push(
        `INFO: Per-scheme security control enabled. Schemes in input: ${Array.from(schemesInInput).join(', ')}`,
      );
    }

    // Validate that all schemes have mappings (except those in input)
    for (const scheme of securitySchemes) {
      // Skip schemes that will be provided via input
      if (schemesInInput.has(scheme)) {
        continue;
      }
      // Check if there's a mapping for this scheme
      if (!options.authProviderMapper?.[scheme]) {
        result.valid = false;
        result.missingMappings.push(scheme);
      }
    }

    if (!result.valid) {
      result.warnings.push(
        `ERROR: Missing auth provider mappings for security schemes: ${result.missingMappings.join(', ')}`,
      );
    }

    return withPassthroughRisk(result, securitySchemes, options);
  }

  // No auth configuration provided
  if (securitySchemes.size > 0 && options.passthroughCallerToken !== true) {
    const schemesStr = Array.from(securitySchemes).join(', ');
    result.securityRiskScore = 'medium';
    result.warnings.push(
      `SECURITY WARNING: No auth configuration provided, so the adapter has no credentials for the API (security schemes: ${schemesStr}). ` +
        `Operations that require authentication will fail. The MCP client's own token is not forwarded: configure authProviderMapper, securityResolver or staticAuth, ` +
        `or set passthroughCallerToken: true if the API is meant to receive the caller's MCP token.`,
    );
  }

  return withPassthroughRisk(result, securitySchemes, options);
}

/**
 * Whether `createSecurityContextFromAuth` can forward the caller's token: `passthroughCallerToken`
 * is set and nothing ahead of it always answers. A `securityResolver` always does, and so does
 * `staticAuth` unless an `authProviderMapper` (which takes precedence and falls back to the
 * caller's token when every mapper returns nothing) is also configured.
 */
function canPassThroughCallerToken(
  options: Pick<
    OpenApiAdapterOptions,
    'securityResolver' | 'authProviderMapper' | 'staticAuth' | 'passthroughCallerToken'
  >,
): boolean {
  if (options.passthroughCallerToken !== true || options.securityResolver) return false;
  return !!options.authProviderMapper || !options.staticAuth;
}

/** Scores the configuration HIGH, with a warning, when the caller's token can reach the API. */
function withPassthroughRisk(
  result: SecurityValidationResult,
  securitySchemes: Set<string>,
  options: Pick<
    OpenApiAdapterOptions,
    'securityResolver' | 'authProviderMapper' | 'staticAuth' | 'passthroughCallerToken'
  >,
): SecurityValidationResult {
  if (securitySchemes.size === 0 || !canPassThroughCallerToken(options)) {
    return result;
  }
  const schemesStr = Array.from(securitySchemes).join(', ');
  const when = options.authProviderMapper ? ' whenever no authProviderMapper function returns a credential' : '';
  result.securityRiskScore = 'high';
  result.warnings.push(
    `SECURITY WARNING: passthroughCallerToken is enabled. The MCP client's own token (ctx.authInfo.token) is sent to the API${when} for security schemes: ${schemesStr}. Only use this when the API accepts tokens issued for this MCP server.`,
  );
  return result;
}

/**
 * Resolve security for an OpenAPI tool with validation
 *
 * @param tool - OpenAPI tool with mapper
 * @param ctx - FrontMCP request context with authInfo, sessionId, traceId, etc.
 * @param options - Adapter options with auth configuration
 * @returns Resolved security (headers, query params, etc.)
 * @throws Error if security cannot be resolved
 */
export async function resolveToolSecurity(
  tool: McpOpenAPITool,
  ctx: FrontMcpContext,
  options: Pick<
    OpenApiAdapterOptions,
    'securityResolver' | 'authProviderMapper' | 'staticAuth' | 'passthroughCallerToken'
  >,
) {
  const securityResolver = new SecurityResolver();
  const securityContext = await createSecurityContextFromAuth(tool, ctx, options);

  // Validate that we have auth for this tool
  const hasAuth =
    securityContext.jwt ||
    securityContext.apiKey ||
    securityContext.basic ||
    securityContext.oauth2Token ||
    (securityContext.apiKeys && Object.keys(securityContext.apiKeys).length > 0) ||
    (securityContext.customHeaders && Object.keys(securityContext.customHeaders).length > 0);

  // Check if this tool requires security
  // A tool requires security ONLY if a mapper has security with required=true
  // Optional security schemes (required=false or undefined) should not block requests
  const requiresSecurity = tool.mapper.some((m) => m.security && m.required === true);

  if (requiresSecurity && !hasAuth) {
    // Extract required security scheme names for error message
    const requiredSchemes = tool.mapper
      .filter((m) => m.security && m.required === true)
      .map((m) => m.security?.scheme ?? 'unknown');
    const uniqueSchemes = [...new Set(requiredSchemes)];
    const schemesStr = uniqueSchemes.join(', ') || 'unknown';
    const firstScheme = uniqueSchemes[0] || 'BearerAuth';

    throw new Error(
      `Authentication required for tool '${tool.name}' but no auth configuration found.\n` +
        `Required security schemes: ${schemesStr}\n` +
        `Solutions:\n` +
        `  1. Add authProviderMapper: { '${firstScheme}': (ctx) => ctx.authInfo.user?.token }\n` +
        `  2. Add securityResolver: async (tool, ctx) => ({ jwt: await getApiToken(ctx) })\n` +
        `  3. Add staticAuth: { jwt: process.env.API_TOKEN }\n` +
        `  4. Set passthroughCallerToken: true, only if the API accepts the MCP client's own token\n` +
        `  5. Set generateOptions.includeSecurityInInput: true (not recommended for production)`,
    );
  }

  return await securityResolver.resolve(tool.mapper, securityContext);
}
