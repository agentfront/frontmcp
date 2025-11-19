import type { McpOpenAPITool, SecurityResolver } from 'mcp-from-openapi';

/**
 * Request configuration for building HTTP requests
 */
export interface RequestConfig {
  url: string;
  headers: Headers;
  body?: Record<string, unknown>;
}

/**
 * Build HTTP request from OpenAPI tool and input parameters
 *
 * @param tool - OpenAPI tool definition with mapper
 * @param input - User input parameters
 * @param security - Resolved security (headers, query params, etc.)
 * @param baseUrl - API base URL
 * @returns Request configuration ready for fetch
 */
export function buildRequest(
  tool: McpOpenAPITool,
  input: Record<string, unknown>,
  security: Awaited<ReturnType<SecurityResolver['resolve']>>,
  baseUrl: string
): RequestConfig {
  const apiBaseUrl = tool.metadata.servers?.[0]?.url || baseUrl;
  let path = tool.metadata.path;
  const queryParams = new URLSearchParams();
  const headers = new Headers({
    accept: 'application/json',
    ...security.headers,
  });
  let body: Record<string, unknown> | undefined;

  // Process each mapper entry
  for (const mapper of tool.mapper) {
    // Skip security parameters (already handled by SecurityResolver)
    if (mapper.security) continue;

    const value = input[mapper.inputKey];

    // Check required parameters
    if (value === undefined || value === null) {
      if (mapper.required) {
        throw new Error(
          `Required parameter '${mapper.inputKey}' is missing for operation ${tool.name}`
        );
      }
      continue;
    }

    // Apply parameter to correct location
    switch (mapper.type) {
      case 'path':
        path = path.replace(`{${mapper.key}}`, encodeURIComponent(String(value)));
        break;

      case 'query':
        queryParams.set(mapper.key, String(value));
        break;

      case 'header':
        headers.set(mapper.key, String(value));
        break;

      case 'body':
        if (!body) body = {};
        body[mapper.key] = value;
        break;
    }
  }

  // Add query parameters from security (e.g., API keys in query string)
  Object.entries(security.query).forEach(([key, value]) => {
    queryParams.set(key, value);
  });

  // Ensure all path parameters are resolved
  if (path.includes('{')) {
    throw new Error(
      `Failed to resolve all path parameters in ${path} for operation ${tool.name}`
    );
  }

  // Build final URL
  const queryString = queryParams.toString();
  const url = `${apiBaseUrl}${path}${queryString ? `?${queryString}` : ''}`;

  return { url, headers, body };
}

/**
 * Apply custom headers to request
 *
 * @param headers - Current headers
 * @param additionalHeaders - Additional static headers to add
 */
export function applyAdditionalHeaders(
  headers: Headers,
  additionalHeaders?: Record<string, string>
): void {
  if (!additionalHeaders) return;

  Object.entries(additionalHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });
}

/**
 * Parse API response based on content type
 *
 * @param response - Fetch response
 * @returns Parsed response data
 */
export async function parseResponse(response: Response): Promise<{ data: unknown }> {
  const contentType = response.headers.get('content-type');
  const text = await response.text();

  // Check for error responses
  if (!response.ok) {
    throw new Error(
      `API request failed: ${response.status} ${response.statusText}\n${text}`
    );
  }

  // Parse JSON responses
  if (contentType?.includes('application/json')) {
    try {
      return { data: JSON.parse(text) };
    } catch (error) {
      // Invalid JSON, return as text
      console.warn('Failed to parse JSON response:', error);
      return { data: text };
    }
  }

  // Return text for non-JSON responses
  return { data: text };
}
