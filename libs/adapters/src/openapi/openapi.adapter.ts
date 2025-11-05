import {
  Adapter,
  DynamicAdapter,
  FrontMcpAdapterResponse,
  tool,
} from '@frontmcp/sdk';
import {OpenApiAdapterOptions} from './openapi.types';
import {z} from 'zod';
import {getToolsFromOpenApi, McpToolDefinition} from 'openapi-mcp-generator';
import {convertJsonSchemaToZod} from 'zod-from-json-schema';


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
    const openApiTools = await withSilencedConsole(getToolsFromOpenApi(openapiLink, {
      dereference: false,
    }));

    return {
      tools: this.parseTools(openApiTools),
    };
  }

  private parseTools(openApiTools: McpToolDefinition[]) {
    return openApiTools.map(oTool => {
      const inputSchema = this.getZodSchemaFromJsonSchema(oTool.inputSchema, oTool.name);
      // const outputSchema = this.getZodSchemaFromJsonSchema(oTool.outputSchema, oTool.name);

      return tool({
        id: oTool.name,
        name: oTool.name,
        description: oTool.description,
        inputSchema: inputSchema.shape,
        rawInputSchema: oTool.inputSchema as any,
        // outputSchema: outputSchema.shape
      })((input, ctx) => {
        return {
          data: {
            id: '1',
            name: 'test',
          },
        };
      });
    });
  }


  /**
   * Converts a JSON Schema to a Zod schema for runtime validation
   *
   * @param jsonSchema JSON Schema
   * @param toolName Tool name for error reporting
   * @returns Zod schema
   */
  private getZodSchemaFromJsonSchema(jsonSchema: any, toolName: string): z.ZodObject<any> {
    if (typeof jsonSchema !== 'object' || jsonSchema === null) {
      return z.object({}).passthrough();
    }
    try {
      const zodSchema = convertJsonSchemaToZod(jsonSchema);
      if (typeof zodSchema?.parse !== 'function') {
        throw new Error('Eval did not produce a valid Zod schema.');
      }
      return zodSchema as any;
    } catch (err: any) {
      console.error(`Failed to generate/evaluate Zod schema for '${toolName}':`, err);
      return z.object({}).passthrough();
    }
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
