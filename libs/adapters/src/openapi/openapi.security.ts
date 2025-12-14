import { SecurityResolver, createSecurityContext, type McpOpenAPITool, type SecurityContext } from 'mcp-from-openapi';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
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
 * Resolve security context from FrontMCP auth info with support for multiple auth providers
 *
 * @param tool - OpenAPI tool to resolve security for
 * @param authInfo - FrontMCP authentication info
 * @param options - Adapter options with auth configuration
 * @returns Security context for resolver
 */
export async function createSecurityContextFromAuth(
  tool: McpOpenAPITool,
  authInfo: AuthInfo,
  options: Pick<OpenApiAdapterOptions, 'securityResolver' | 'authProviderMapper' | 'staticAuth'>,
): Promise<SecurityContext> {
  // 1. Use custom security resolver if provided (highest priority)
  if (options.securityResolver) {
    return await options.securityResolver(tool, authInfo);
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
          const token = authExtractor(authInfo);

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

    // If no auth was set from providers, fall back to authInfo.token
    // Only fall back if ALL auth fields are empty (not just jwt)
    const hasAnyAuth = context.jwt || context.apiKey || context.basic || context.oauth2Token;
    if (!hasAnyAuth && authInfo.token) {
      // Validate type before assignment to prevent non-string values
      if (typeof authInfo.token !== 'string') {
        throw new Error(`authInfo.token must be a string, but got: ${typeof authInfo.token}`);
      }
      context.jwt = authInfo.token;
    }

    return context;
  }

  // 3. Use static auth if provided
  if (options.staticAuth) {
    return createSecurityContext(options.staticAuth);
  }

  // 4. Default: use main JWT token from auth context
  return createSecurityContext({
    jwt: authInfo?.token,
  });
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
    'securityResolver' | 'authProviderMapper' | 'staticAuth' | 'generateOptions' | 'securitySchemesInInput'
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
    return result;
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

    return result;
  }

  // No auth configuration provided - will use default ctx.authInfo.token
  // This only works if there's a single Bearer auth scheme
  if (securitySchemes.size > 0) {
    result.securityRiskScore = 'medium';
    result.warnings.push(
      `INFO: No auth configuration provided. Using default ctx.authInfo.token for all security schemes: ${Array.from(
        securitySchemes,
      ).join(', ')}`,
    );
    result.warnings.push(
      'RECOMMENDATION: For multiple auth providers, use authProviderMapper or securityResolver to map each security scheme to the correct auth provider.',
    );
  }

  return result;
}

/**
 * Resolve security for an OpenAPI tool with validation
 *
 * @param tool - OpenAPI tool with mapper
 * @param authInfo - FrontMCP authentication info
 * @param options - Adapter options with auth configuration
 * @returns Resolved security (headers, query params, etc.)
 * @throws Error if security cannot be resolved
 */
export async function resolveToolSecurity(
  tool: McpOpenAPITool,
  authInfo: AuthInfo,
  options: Pick<OpenApiAdapterOptions, 'securityResolver' | 'authProviderMapper' | 'staticAuth'>,
) {
  const securityResolver = new SecurityResolver();
  const securityContext = await createSecurityContextFromAuth(tool, authInfo, options);

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
        `  1. Add authProviderMapper: { '${firstScheme}': (authInfo) => authInfo.user?.token }\n` +
        `  2. Add securityResolver: (tool, authInfo) => ({ jwt: authInfo.token })\n` +
        `  3. Add staticAuth: { jwt: process.env.API_TOKEN }\n` +
        `  4. Set generateOptions.includeSecurityInInput: true (not recommended for production)`,
    );
  }

  return await securityResolver.resolve(tool.mapper, securityContext);
}
