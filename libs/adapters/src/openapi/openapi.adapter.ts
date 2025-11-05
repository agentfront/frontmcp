import {
  Adapter,
  DynamicAdapter,
  FrontMcpAdapterResponse,
} from '@frontmcp/sdk';
import {OpenApiAdapterOptions} from './openapi.types';
import {getToolsFromOpenApi, McpToolDefinition} from 'openapi-mcp-generator';
import {createOpenApiTool} from "./openapi.tool";
import {OpenAPIV3} from "openapi-types";

@Adapter({
  name: 'openapi',
  description: 'OpenAPI adapter that  plugin for expense-mcp',
})
export default class OpenapiAdapter extends DynamicAdapter<OpenApiAdapterOptions> {
  options: OpenApiAdapterOptions;

  constructor(options: OpenApiAdapterOptions) {
    super();
    this.options = options;
  }


  async fetch(): Promise<FrontMcpAdapterResponse> {
    let urlOrSpec: string | OpenAPIV3.Document = ''
    if ('url' in this.options) {
      urlOrSpec = this.options.url;
    } else if ('spec' in this.options) {
      urlOrSpec = this.options.spec;
    } else {
      throw new Error('Either url or spec must be provided');
    }
    const {baseUrl, filterFn, defaultInclude, excludeOperationIds} = this.options;
    const openApiTools = await getToolsFromOpenApi(urlOrSpec, {
      baseUrl,
      filterFn,
      defaultInclude,
      excludeOperationIds,
      dereference: false,
    });

    return {
      tools: this.parseTools(openApiTools),
    };
  }

  private parseTools(openApiTools: McpToolDefinition[]) {
    return openApiTools.map(tool => {
      return createOpenApiTool(tool, this.options);
    });
  }
}