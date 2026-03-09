import { InternalMcpError } from '@frontmcp/sdk';

/**
 * Thrown when fetching the OpenAPI spec from a remote URL fails with a non-ok HTTP status.
 */
export class OpenAPIFetchError extends InternalMcpError {
  constructor(url: string, status: number, statusText: string) {
    super(`OpenAPI spec fetch failed from "${url}": ${status} ${statusText}`, 'OPENAPI_FETCH_FAILED');
  }
}
