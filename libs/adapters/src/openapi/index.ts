export { default } from './openapi.adapter';
export * from './openapi.types';
export * from './openapi.spec-utils';
export type { OpenApiResponse, RequestConfig, ParseResponseOptions } from './openapi.utils';
export { buildRequest, parseResponse, applyAdditionalHeaders } from './openapi.utils';
export {
  createSecurityContextFromAuth,
  resolveToolSecurity,
  extractSecuritySchemes,
  validateSecurityConfiguration,
  type SecuritySchemeInfo,
  type SecurityValidationResult,
} from './openapi.security';
export { OpenApiSpecPoller } from './openapi-spec-poller';
export * from './openapi-spec-poller.types';
export { OpenAPIFetchError } from './openapi.errors';

/**
 * Forward type re-exports from `mcp-from-openapi` so downstream consumers
 * (e.g. `@frontmcp/plugin-skilled-openapi`) can build OpenAPI runtime calls
 * via `buildRequest` / `parseResponse` / `resolveToolSecurity` without taking
 * a direct dependency on the upstream package.
 */
export type {
  McpOpenAPITool,
  ParameterMapper,
  ParameterLocation,
  ToolMetadata as OpenApiToolMetadata,
  HTTPMethod,
} from 'mcp-from-openapi';
export type { SecurityContext, SecurityResolver } from 'mcp-from-openapi';
