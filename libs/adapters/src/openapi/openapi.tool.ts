import {z} from "zod";
import {McpToolDefinition} from "openapi-mcp-generator";
import {tool} from "@frontmcp/sdk";
import {convertJsonSchemaToZod} from "zod-from-json-schema";
import {OpenApiAdapterOptions} from "./openapi.types";


export const createOpenApiTool = (oTool: McpToolDefinition, options: OpenApiAdapterOptions) => {
  const inputSchema = getZodSchemaFromJsonSchema(oTool.inputSchema, oTool.name);

  const {additionalHeaders, headersMapper} = options;
  return tool({
    id: oTool.name,
    name: oTool.name,
    description: oTool.description,
    inputSchema: inputSchema as any,
    rawInputSchema: oTool.inputSchema as any,
    // outputSchema: outputSchema.shape
  })(async (input, ctx) => {

    let {urlPath, headers, queryParams} = prepareUrl(oTool, input);
    let requestBodyData: any = undefined;

    if (additionalHeaders) {
      for (const [key, value] of Object.entries(additionalHeaders)) {
        headers.append(key, value);
      }
    }
    if (typeof headersMapper === 'function') {
      headers = headersMapper(ctx.authInfo, headers)
    }

    if (!['HEAD', 'GET', 'OPTIONS'].includes(oTool.method)) {
      // prepare body
      if (oTool.requestBodyContentType && typeof input['requestBody'] !== 'undefined') {
        requestBodyData = input['requestBody'];
        headers.set('content-type', oTool.requestBodyContentType);
      }
    }

    const query = queryParams.toString()
    const url = `${options.baseUrl}${urlPath}${query ? `?${query}` : ''}`;
    const res = await fetch(url, {
      method: oTool.method,
      headers,
      body: requestBodyData,
    });
    const data = await res.text()
    let result = {data}
    if (res.headers.get('content-type')?.includes('application/json')) {
      try {
        result.data = JSON.parse(data)
      } catch (e) {
        console.error("failed to parse api response")// migrate to logger
        result.data = data
      }
    }
    return result
  });
};


/**
 * Converts a JSON Schema to a Zod schema for runtime validation
 *
 * @param jsonSchema JSON Schema
 * @param toolName Tool name for error reporting
 * @returns Zod schema
 */
function getZodSchemaFromJsonSchema(jsonSchema: any, toolName: string): z.ZodObject<any> {
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

const prepareUrl = (definition: McpToolDefinition, validatedArgs: any) => {
  // Prepare URL, query parameters, headers, and request body
  let urlPath = definition.pathTemplate;
  const queryParams = new URLSearchParams({"v": '1'})
  const headers = new Headers({'accept': 'application/json'})


  // Apply parameters to the URL path, query, or headers
  definition.executionParameters.forEach((param) => {
    const value = validatedArgs[param.name];
    if (typeof value !== 'undefined' && value !== null) {
      if (param.in === 'path') {
        urlPath = urlPath.replace(`{${param.name}}`, encodeURIComponent(String(value)));
      } else if (param.in === 'query') {
        queryParams.set(param.name, value)
      } else if (param.in === 'header') {
        headers.append(param.name.toLowerCase(), String(value));
      }
    }
  });

  // Ensure all path parameters are resolved
  if (urlPath.includes('{')) {
    throw new Error(`Failed to resolve path parameters: ${urlPath}`);
  }

  return {urlPath, headers, queryParams};
}