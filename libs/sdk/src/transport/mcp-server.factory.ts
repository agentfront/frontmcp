import { AjvJsonSchemaValidator, McpServer, type Implementation, type McpServerOptions } from '@frontmcp/protocol';

// The MCP server builds Ajv to check the elicitation results it requests itself, which FrontMCP never does; build it on first use.
export function createMcpServer(info: Implementation, options: McpServerOptions): McpServer {
  let validator: AjvJsonSchemaValidator | undefined;
  return new McpServer(info, {
    ...options,
    jsonSchemaValidator: {
      getValidator: (schema) => (validator ??= new AjvJsonSchemaValidator()).getValidator(schema),
    },
  });
}
