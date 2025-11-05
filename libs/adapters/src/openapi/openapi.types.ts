import {AuthInfo} from "@modelcontextprotocol/sdk/server/auth/types.js";
import {GetToolsOptions} from "openapi-mcp-generator/dist/api";
import {OpenAPIV3} from "openapi-types";

interface BaseOptions extends Omit<GetToolsOptions, 'dereference'> {
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
  bodyMapper?: (authInfo: AuthInfo, body: any) => any;
  // /**
  //  * This can be used to map request information to specific
  //  * input schema values as required by the API.
  //  * For example, mapping tenantId from authenticated session payload to
  //  * a specific proprty in the input schema, this key will be hidden to mcp clients
  //  * and filled by the adapter before sending the request to the API.
  //  * @param authInfo
  //  * @param request
  //  */
  // inputSchemaMapper?: (inputSchema: any) => any;
}

interface SpecOptions extends BaseOptions {
  /**
   * The OpenAPI specification the OpenAPI specification.
   *
   * @example
   * ```json
   * {
   *   "openapi": "3.0.0",
   *   "info": {
   *     "title": "My API",
   *     "version": "1.0.0"
   *   },
   *   "paths": {
   *     "/users": {
   `
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
