import {
  createSecurityContext,
  SecurityResolver,
  type McpOpenAPITool,
  type ParameterMapper,
  type ResolvedSecurity,
  type SecurityContext,
  type SecurityParameterInfo,
} from 'mcp-from-openapi';

import { PublicMcpError, type FrontMcpContext } from '@frontmcp/sdk';

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
    const context: Partial<SecurityContext> = {};

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

    // 3. staticAuth answers for every credential no mapper function returned (a mapped value wins).
    if (hasStaticAuth(options)) {
      return createSecurityContext({ ...options.staticAuth, ...context });
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

    return createSecurityContext(context);
  }

  // 3. Use static auth if provided
  if (hasStaticAuth(options)) {
    return createSecurityContext(options.staticAuth);
  }

  // 4. No credential source: forward the caller's token only when explicitly enabled.
  // The caller's token was issued for this MCP server, not for the API (token passthrough).
  if (options.passthroughCallerToken === true) {
    return createSecurityContext({ jwt: getCallerToken(ctx) });
  }
  return createSecurityContext({});
}

/** Whether `staticAuth` holds any credential entry (an empty object is treated as absent). */
function hasStaticAuth(
  options: Pick<OpenApiAdapterOptions, 'staticAuth'>,
): options is { staticAuth: Partial<SecurityContext> } {
  return !!options.staticAuth && Object.keys(options.staticAuth).length > 0;
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

/** The security schemes a set of tools uses, by name, as their mapper entries describe them. */
function describeSecuritySchemes(tools: McpOpenAPITool[]): Map<string, SecurityParameterInfo> {
  const schemes = new Map<string, SecurityParameterInfo>();
  for (const tool of tools) {
    for (const mapper of tool.mapper) {
      if (mapper.security?.scheme && !schemes.has(mapper.security.scheme)) {
        schemes.set(mapper.security.scheme, mapper.security);
      }
    }
  }
  return schemes;
}

/**
 * Whether the caller's own token (`passthroughCallerToken`) can be a scheme's credential. It is
 * sent as the bearer token (`jwt`), which only an HTTP bearer scheme reads: an API key, basic,
 * OAuth2 or OpenID Connect scheme gets nothing from it.
 */
function isBearerScheme(security: Pick<SecurityParameterInfo, 'type' | 'httpScheme'> | undefined): boolean {
  if (!security || security.type !== 'http') return false;
  return (security.httpScheme ?? 'bearer').toLowerCase() === 'bearer';
}

/** The `SecurityContext` field that carries a scheme's credential, for examples in messages. */
function credentialFieldOf(security: Pick<SecurityParameterInfo, 'type' | 'httpScheme'> | undefined): string {
  if (security?.type === 'apiKey') return 'apiKey';
  if (security?.type === 'oauth2' || security?.type === 'openIdConnect') return 'oauth2Token';
  if (security?.type === 'http' && security.httpScheme?.toLowerCase() === 'basic') return 'basic';
  return 'jwt';
}

/**
 * The startup error for security schemes that no credential option covers, with a suggestion for
 * each: an `authProviderMapper` function (it receives the request context), `securityResolver`,
 * `staticAuth`, and `passthroughCallerToken` only for the HTTP bearer schemes it can fill.
 */
export function formatMissingSecurityMappingsError(
  adapterName: string,
  tools: McpOpenAPITool[],
  missingMappings: string[],
): string {
  const schemes = describeSecuritySchemes(tools);
  const fieldOf = (scheme: string) => credentialFieldOf(schemes.get(scheme));
  const firstField = fieldOf(missingMappings[0] ?? '');
  const bearerSchemes = missingMappings.filter((scheme) => isBearerScheme(schemes.get(scheme)));
  const lines = [
    `[OpenAPI Adapter: ${adapterName}] Invalid security configuration.`,
    `Missing auth provider mappings for security schemes: ${missingMappings.join(', ')}`,
    '',
    'Your OpenAPI spec requires these security schemes, but no credential option covers them.',
    '',
    'Add one of the following to your adapter configuration:',
    '',
    '1. authProviderMapper (recommended): a function per scheme that returns the credential issued for the API:',
    '   authProviderMapper: {',
    ...missingMappings.map((scheme) => `     '${scheme}': (ctx) => getApiCredential(ctx), // the ${fieldOf(scheme)}`),
    '   }',
    '',
    '2. securityResolver:',
    `   securityResolver: async (tool, ctx) => ({ ${firstField}: await getApiCredential(ctx) })`,
    '',
    '3. staticAuth (one credential for every caller):',
    `   staticAuth: { ${firstField}: process.env.API_CREDENTIAL }`,
  ];
  if (bearerSchemes.length > 0) {
    lines.push(
      '',
      `4. passthroughCallerToken: true, for the HTTP bearer schemes (${bearerSchemes.join(', ')}) only, and only if the API`,
      "   accepts the MCP client's own token (same issuer and audience). It sends nothing for other schemes.",
    );
  }
  return lines.join('\n');
}

/**
 * The error for a call whose operation requires authentication and would be sent with no
 * credential for any of its security schemes.
 */
function authenticationRequiredError(tool: McpOpenAPITool): Error {
  const required = requiredSecurityOf(tool);
  const schemes = [...new Map(required.map((security) => [security.scheme, security])).values()];
  const schemesStr = schemes.map((security) => `${security.scheme} (${security.type})`).join(', ') || 'unknown';
  const first = schemes[0];
  const firstScheme = first?.scheme ?? 'BearerAuth';
  const field = credentialFieldOf(first);
  const bearerSchemes = schemes.filter(isBearerScheme).map((security) => security.scheme);
  const solutions = [
    `  1. Add authProviderMapper: { '${firstScheme}': (ctx) => getApiCredential(ctx) }, returning the ${field} issued for the API`,
    `  2. Add securityResolver: async (tool, ctx) => ({ ${field}: await getApiCredential(ctx) })`,
    `  3. Add staticAuth: { ${field}: process.env.API_CREDENTIAL }`,
  ];
  if (bearerSchemes.length > 0) {
    solutions.push(
      `  4. Set passthroughCallerToken: true, only if the API accepts the MCP client's own token (it fills ${bearerSchemes.join(', ')} only)`,
    );
  }
  return new Error(
    `Authentication required for tool '${tool.name}': no credential for its security schemes.\n` +
      `Required security schemes: ${schemesStr}\n` +
      `Solutions:\n` +
      solutions.join('\n'),
  );
}

/** The mapper entries of an operation's security schemes. */
function requiredSecurityOf(tool: McpOpenAPITool): SecurityParameterInfo[] {
  return tool.mapper.flatMap((mapper) => (mapper.security && mapper.required === true ? [mapper.security] : []));
}

/** Whether a request carries the parameter a security scheme's credential goes in. */
function carriesSchemeParameter(mapper: ParameterMapper, url: URL, headers: Headers): boolean {
  if (mapper.type === 'query') return !!url.searchParams.get(mapper.key);
  if (mapper.type === 'cookie') {
    return (headers.get('cookie') ?? '').split(';').some((pair) => {
      const [name, ...value] = pair.trim().split('=');
      return name === mapper.key && value.join('=') !== '';
    });
  }
  return mapper.type === 'header' && !!headers.get(mapper.key);
}

/**
 * Refuse a request, before it is sent, when its operation requires authentication and the request
 * carries no credential for any of the operation's security schemes.
 *
 * `resolveToolSecurity` only checks that some credential source answered. That answer may not fit
 * the operation: `passthroughCallerToken` and a `staticAuth` holding only `jwt` fill the bearer
 * token, which an API key, basic, OAuth2 or OpenID Connect scheme never reads, so the request
 * would go out with no credential at all. The request is checked as built, after `additionalHeaders`
 * and `headersMapper`, so a key those set counts. An OpenAPI spec may accept any one of an
 * operation's schemes, so one is enough.
 *
 * @throws Error `Authentication required for tool '…'`
 */
export function assertRequestHasCredential(tool: McpOpenAPITool, url: string, headers: Headers): void {
  const securityMappers = tool.mapper.filter((mapper) => mapper.security && mapper.required === true);
  if (securityMappers.length === 0) return;
  const parsedUrl = new URL(url);
  if (!securityMappers.some((mapper) => carriesSchemeParameter(mapper, parsedUrl, headers))) {
    throw authenticationRequiredError(tool);
  }
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
  const result = validateCredentialSources(tools, options);
  // `securitySchemesInInput` lets the model choose the credential of the schemes it lists, as
  // `includeSecurityInInput` does for every scheme: the same risk.
  const schemesInInput = options.securitySchemesInInput ?? [];
  if (options.generateOptions?.includeSecurityInInput !== true && schemesInInput.length > 0) {
    result.securityRiskScore = 'high';
    result.warnings.push(
      `SECURITY WARNING: securitySchemesInInput is enabled. The model provides the credential for security schemes ${schemesInInput.join(', ')} in tool inputs, used when the server supplies none. Credentials may be logged or exposed, and the model chooses whose account a call uses.`,
    );
  }
  return result;
}

/** `validateSecurityConfiguration` for the options that supply credentials, without `securitySchemesInInput`'s risk. */
function validateCredentialSources(
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
  const securitySchemes = describeSecuritySchemes(tools);

  // If includeSecurityInInput is true, auth is provided by user (high security risk)
  const includeSecurityInInput = options.generateOptions?.includeSecurityInInput ?? false;

  if (includeSecurityInInput) {
    result.securityRiskScore = 'high';
    result.warnings.push(
      'SECURITY WARNING: includeSecurityInInput is enabled. Users will provide authentication directly in tool inputs (used for a scheme when the server supplies none). This increases security risk as credentials may be logged or exposed.',
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
  if (hasStaticAuth(options)) {
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
    result.securityRiskScore = 'low';

    // Validate that all schemes have mappings (except those in input). A scheme without one is
    // covered only when passthroughCallerToken is the declared fallback, as it is at call time, and
    // only for an HTTP bearer scheme: the caller's token is sent as the bearer token, which an API
    // key, basic, OAuth2 or OpenID Connect scheme never reads.
    const passthroughFallback: string[] = [];
    for (const [scheme, security] of securitySchemes) {
      // Skip schemes that will be provided via input
      if (schemesInInput.has(scheme)) {
        continue;
      }
      // Check if there's a mapping for this scheme
      if (!options.authProviderMapper?.[scheme]) {
        if (options.passthroughCallerToken === true && isBearerScheme(security)) {
          passthroughFallback.push(scheme);
        } else {
          result.valid = false;
          result.missingMappings.push(scheme);
        }
      }
    }

    if (!result.valid) {
      result.warnings.push(
        `ERROR: Missing auth provider mappings for security schemes: ${result.missingMappings.join(', ')}`,
      );
    }

    withPassthroughRisk(result, securitySchemes, options);
    if (passthroughFallback.length > 0) {
      result.warnings.push(
        `SECURITY WARNING: Security schemes with no authProviderMapper entry (${passthroughFallback.join(', ')}) get the MCP client's own token, because passthroughCallerToken is enabled.`,
      );
    }
    return result;
  }

  // No auth configuration provided
  if (securitySchemes.size > 0 && options.passthroughCallerToken !== true) {
    const schemesStr = Array.from(securitySchemes.keys()).join(', ');
    result.securityRiskScore = 'medium';
    result.warnings.push(
      `SECURITY WARNING: No auth configuration provided, so the adapter has no credentials for the API (security schemes: ${schemesStr}). ` +
        `Operations that require authentication fail unless additionalHeaders or headersMapper sets their credential. The MCP client's own token is not forwarded: configure authProviderMapper, securityResolver or staticAuth, ` +
        `or set passthroughCallerToken: true if the API is meant to receive the caller's MCP token.`,
    );
  }

  // passthroughCallerToken alone: the caller's token fills only HTTP bearer schemes.
  const unfilled = [...securitySchemes].filter(([, security]) => !isBearerScheme(security)).map(([scheme]) => scheme);
  if (options.passthroughCallerToken === true && unfilled.length > 0) {
    result.securityRiskScore = 'medium';
    result.warnings.push(
      `SECURITY WARNING: The adapter has no credentials for the API for security schemes: ${unfilled.join(', ')}. ` +
        `passthroughCallerToken sends only a bearer token, which these schemes don't use, so operations that require only them fail unless additionalHeaders or headersMapper sets their credential. ` +
        `Configure authProviderMapper, securityResolver or staticAuth for them.`,
    );
  }

  return withPassthroughRisk(result, securitySchemes, options);
}

/**
 * Whether `createSecurityContextFromAuth` can forward the caller's token: `passthroughCallerToken`
 * is set and nothing ahead of it always answers. A `securityResolver` always does, and so does
 * `staticAuth`, which also answers for every scheme an `authProviderMapper` returns nothing for.
 */
function canPassThroughCallerToken(
  options: Pick<OpenApiAdapterOptions, 'securityResolver' | 'staticAuth' | 'passthroughCallerToken'>,
): boolean {
  return options.passthroughCallerToken === true && !options.securityResolver && !hasStaticAuth(options);
}

/**
 * Scores the configuration HIGH, with a warning, when the caller's token can reach the API: when
 * it may be forwarded and a security scheme takes it, which only an HTTP bearer scheme does.
 */
function withPassthroughRisk(
  result: SecurityValidationResult,
  securitySchemes: Map<string, SecurityParameterInfo>,
  options: Pick<
    OpenApiAdapterOptions,
    'securityResolver' | 'authProviderMapper' | 'staticAuth' | 'passthroughCallerToken'
  >,
): SecurityValidationResult {
  const bearerSchemes = [...securitySchemes].filter(([, security]) => isBearerScheme(security));
  if (bearerSchemes.length === 0 || !canPassThroughCallerToken(options)) {
    return result;
  }
  const schemesStr = bearerSchemes.map(([scheme]) => scheme).join(', ');
  const when = options.authProviderMapper ? ' whenever no authProviderMapper function returns a credential' : '';
  result.securityRiskScore = 'high';
  result.warnings.push(
    `SECURITY WARNING: passthroughCallerToken is enabled. The MCP client's own token (ctx.authInfo.token) is sent to the API${when} for security schemes: ${schemesStr}. Only use this when the API accepts tokens issued for this MCP server.`,
  );
  return result;
}

/**
 * How `resolveToolSecurity` is used for one call.
 */
export interface ResolveToolSecurityRequest {
  /**
   * The tool's input: the credentials it carries for the schemes `generateOptions.includeSecurityInInput`
   * or `securitySchemesInInput` put there are resolved too, and used for a scheme only when the
   * server supplies none for it (a credential option here, `additionalHeaders` or `headersMapper`
   * after): the model chooses them, so a prompt injection could otherwise swap in another account.
   */
  input?: Record<string, unknown>;
  /**
   * The caller checks the request it builds with `assertRequestHasCredential` (after
   * `additionalHeaders` and `headersMapper`), so an operation is not refused here for a context with
   * no credential: a header those set, or an input credential, may still supply it.
   */
  deferCredentialCheck?: boolean;
}

/**
 * Resolve security for an OpenAPI tool with validation
 *
 * @param tool - OpenAPI tool with mapper
 * @param ctx - FrontMCP request context with authInfo, sessionId, traceId, etc.
 * @param options - Adapter options with auth configuration
 * @param request - The call's input, and whether the caller checks the built request itself
 * @returns Resolved security (headers, query params, etc.)
 * @throws Error if security cannot be resolved
 */
export async function resolveToolSecurity(
  tool: McpOpenAPITool,
  ctx: FrontMcpContext,
  options: Pick<
    OpenApiAdapterOptions,
    | 'securityResolver'
    | 'authProviderMapper'
    | 'staticAuth'
    | 'passthroughCallerToken'
    | 'generateOptions'
    | 'securitySchemesInInput'
  >,
  request: ResolveToolSecurityRequest = {},
): Promise<ResolvedSecurity> {
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

  // Credentials the tool input carries for its schemes (`includeSecurityInInput`,
  // `securitySchemesInInput`) count like any other, but only where the server supplies none: the
  // model chooses them. `additionalHeaders` and `headersMapper` set their headers over these too.
  const fromInput = request.input
    ? await resolveInputSecurity(tool, request.input, options, securityResolver)
    : undefined;
  const hasInputCredential =
    !!fromInput &&
    Object.keys(fromInput.headers).length +
      Object.keys(fromInput.query).length +
      Object.keys(fromInput.cookies).length >
      0;

  // A credential may still not fit the operation's schemes (a bearer token for an API-key scheme),
  // and a header `additionalHeaders` or `headersMapper` sets may supply one: a caller that builds the
  // request checks it with `assertRequestHasCredential` and defers this check.
  if (requiresSecurity && !hasAuth && !hasInputCredential && !request.deferCredentialCheck) {
    throw authenticationRequiredError(tool);
  }

  const resolved = await securityResolver.resolve(tool.mapper, securityContext);
  if (!fromInput) return resolved;
  return {
    ...resolved,
    headers: { ...fromInput.headers, ...resolved.headers },
    query: { ...fromInput.query, ...resolved.query },
    cookies: { ...fromInput.cookies, ...resolved.cookies },
  };
}

/** Whether the tool input carries the credential of a scheme (`includeSecurityInInput` / `securitySchemesInInput`). */
function isInputScheme(
  scheme: string,
  options: Pick<OpenApiAdapterOptions, 'generateOptions' | 'securitySchemesInInput'>,
): boolean {
  return (
    options.generateOptions?.includeSecurityInInput === true || (options.securitySchemesInInput ?? []).includes(scheme)
  );
}

/** The credential a scheme reads, for a value the tool input carries (a leading `Bearer ` / `Basic ` is dropped). */
function inputCredentialContext(security: SecurityParameterInfo, value: string): SecurityContext | undefined {
  const bare = value.replace(/^(?:bearer|basic)\s+/i, '');
  if (security.type === 'apiKey') {
    return security.apiKeyName ? { apiKeys: { [security.apiKeyName]: value } } : { apiKey: value };
  }
  if (security.type === 'oauth2' || security.type === 'openIdConnect') return { oauth2Token: bare };
  if (security.type === 'http') {
    const httpScheme = (security.httpScheme ?? 'bearer').toLowerCase();
    if (httpScheme === 'bearer') return { jwt: bare };
    if (httpScheme === 'basic') return { basic: bare };
  }
  return undefined;
}

/**
 * The credentials the tool input carries for the schemes `generateOptions.includeSecurityInInput`
 * or `securitySchemesInInput` put there (as an argument named after the scheme), resolved into the
 * header, query parameter or cookie each scheme uses, as a credential from any other source is.
 *
 * @throws PublicMcpError `INVALID_HEADER_VALUE` for a credential with control characters, like any header parameter
 */
async function resolveInputSecurity(
  tool: McpOpenAPITool,
  input: Record<string, unknown>,
  options: Pick<OpenApiAdapterOptions, 'generateOptions' | 'securitySchemesInInput'>,
  securityResolver: SecurityResolver,
): Promise<ResolvedSecurity> {
  const resolved: ResolvedSecurity = { headers: {}, query: {}, cookies: {} };
  for (const mapper of tool.mapper) {
    const security = mapper.security;
    if (!security || !isInputScheme(security.scheme, options)) continue;
    const value = input[mapper.inputKey];
    if (typeof value !== 'string' || value === '') continue;
    // eslint-disable-next-line no-control-regex
    if (/[\r\n\x00\f\v]/.test(value)) {
      throw new PublicMcpError(
        `Invalid value for '${mapper.inputKey}': contains control characters (possible header injection attack)`,
        'INVALID_HEADER_VALUE',
        400,
      );
    }
    const context = inputCredentialContext(security, value);
    if (!context) continue;
    const one = await securityResolver.resolve([mapper], createSecurityContext(context));
    Object.assign(resolved.headers, one.headers);
    Object.assign(resolved.query, one.query);
    Object.assign(resolved.cookies, one.cookies);
  }
  return resolved;
}
