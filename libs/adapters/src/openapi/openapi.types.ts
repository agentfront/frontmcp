import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { OpenAPIV3 } from 'openapi-types';
import type { LoadOptions, GenerateOptions } from 'mcp-from-openapi';

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
   * @param authInfo
   * @param headers
   */
  headersMapper?: (authInfo: AuthInfo, headers: Headers) => Headers;

  /**
   * This can be used to map request information to specific
   * body values as required by the API.
   * For example, mapping tenantId from authenticated session payload to
   * a specific property in the body, this key will be hidden to mcp clients
   * and filled by the adapter before sending the request to the API.
   *
   * @param authInfo
   * @param body
   */
  bodyMapper?: (authInfo: AuthInfo, body: Record<string, unknown>) => Record<string, unknown>;

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
}

interface SpecOptions extends BaseOptions {
  /**
   * The OpenAPI specification the OpenAPI specification.
   */
  spec: OpenAPIV3.Document;
}

interface UrlOptions extends BaseOptions {
  /**
   * The URL of the OpenAPI specification.
   * Can be a local file path or a remote URL.
   */
  url: string;
}

export type OpenApiAdapterOptions = SpecOptions | UrlOptions;
