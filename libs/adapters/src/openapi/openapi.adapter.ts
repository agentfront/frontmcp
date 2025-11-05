import {
  Adapter,
  DynamicAdapter,
  FrontMcpAdapterResponse,
} from '@frontmcp/sdk';
import {OpenApiAdapterOptions} from './openapi.types';
import {getToolsFromOpenApi, McpToolDefinition} from 'openapi-mcp-generator';
import {createOpenApiTool} from "./openapi.tool";


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
    const openapiLink = this.options.url
    const {baseUrl, filterFn, defaultInclude, excludeOperationIds} = this.options;
    const openApiTools = await getToolsFromOpenApi(openapiLink, {
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

async function withSilencedConsole(fn: Promise<any>) {
  const methods = ['log', 'info', 'debug', 'warn', 'error', 'table', 'group', 'groupCollapsed', 'groupEnd', 'dir'];
  const originals = {};
  try {
    for (const m of methods) {
      originals[m] = console[m];
      console[m] = () => {
      };
    }
    return await fn;
  } finally {
    for (const m of Object.keys(originals)) console[m] = originals[m];
  }
}
