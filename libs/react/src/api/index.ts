/**
 * @frontmcp/react/api — API client integration for FrontMCP.
 *
 * Register OpenAPI operations as MCP tools so agents can call APIs directly.
 *
 * @packageDocumentation
 */

export { useApiClient } from './useApiClient';
export { parseOpenApiSpec } from './parseOpenApiSpec';
export { createFetchClient } from './createFetchClient';
export type { ApiOperation, ApiClientOptions, HttpClient, HttpRequestConfig, HttpResponse } from './api.types';
