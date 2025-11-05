import {AuthInfo} from "@modelcontextprotocol/sdk/server/auth/types.js";
import {GetToolsOptions} from "openapi-mcp-generator/dist/api";

export interface OpenApiAdapterOptions extends Omit<GetToolsOptions, 'dereference'> {
  name: string;
  url: string;

  additionalHeaders?: Record<string, string>;
  headersMapper?: (authInfo: AuthInfo, headers: Headers) => Headers;
  bodyMapper?: (authInfo: AuthInfo, body: any) => any;
  /**
   * This can be used to map request information to specific
   * input schema values as required by the API.
   * For example, mapping tenantId from authenticated session payload to
   * a specific proprty in the input schema, this key will be hidden to mcp clients
   * and filled by the adapter before sending the request to the API.
   * @param authInfo
   * @param request
   */
  inputSchemaMapper?: (inputSchema: any) => any;
}
