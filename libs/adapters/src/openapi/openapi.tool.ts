import { z } from 'zod';
import { tool } from '@frontmcp/sdk';
import { convertJsonSchemaToZod } from 'json-schema-to-zod-v3';
import type { McpOpenAPITool } from 'mcp-from-openapi';
import type { OpenApiAdapterOptions } from './openapi.types';
import type { JSONSchema } from 'zod/v4/core';

/** JSON Schema type from Zod v4 */
type JsonSchema = JSONSchema.JSONSchema;
import { buildRequest, applyAdditionalHeaders, parseResponse } from './openapi.utils';
import { resolveToolSecurity } from './openapi.security';

/**
 * Create a FrontMCP tool from an OpenAPI tool definition
 *
 * @param openapiTool - OpenAPI tool with mapper
 * @param options - Adapter options
 * @returns FrontMCP tool
 */
export function createOpenApiTool(openapiTool: McpOpenAPITool, options: OpenApiAdapterOptions) {
  // Convert JSON Schema to Zod schema for input validation
  const inputSchema = getZodSchemaFromJsonSchema(openapiTool.inputSchema, openapiTool.name);

  return tool({
    id: openapiTool.name,
    name: openapiTool.name,
    description: openapiTool.description,
    inputSchema: inputSchema.shape || {},
    rawInputSchema: openapiTool.inputSchema,
  })(async (input, ctx) => {
    // 1. Resolve security from context
    const security = await resolveToolSecurity(openapiTool, ctx.authInfo, options);

    // 2. Build request from mapper
    const { url, headers, body: requestBody } = buildRequest(openapiTool, input, security, options.baseUrl);

    // 3. Apply additional headers
    applyAdditionalHeaders(headers, options.additionalHeaders);

    // 4. Apply custom headers mapper
    if (options.headersMapper) {
      const mappedHeaders = options.headersMapper(ctx.authInfo, headers);
      mappedHeaders.forEach((value, key) => {
        headers.set(key, value);
      });
    }

    // 5. Apply custom body mapper
    let finalBody = requestBody;
    if (options.bodyMapper && requestBody) {
      finalBody = options.bodyMapper(ctx.authInfo, requestBody);
    }

    // 6. Set content-type if we have a body
    if (finalBody && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }

    // 7. Execute request
    const response = await fetch(url, {
      method: openapiTool.metadata.method.toUpperCase(),
      headers,
      body: finalBody ? JSON.stringify(finalBody) : undefined,
    });

    // 8. Parse and return response
    return await parseResponse(response);
  });
}

/**
 * Converts a JSON Schema to a Zod schema for runtime validation
 *
 * @param jsonSchema - JSON Schema
 * @param toolName - Tool name for error reporting
 * @returns Zod schema
 */
function getZodSchemaFromJsonSchema(jsonSchema: JsonSchema, toolName: string): z.ZodObject {
  if (typeof jsonSchema !== 'object' || jsonSchema === null) {
    return z.object({}).passthrough();
  }

  try {
    const zodSchema = convertJsonSchemaToZod(jsonSchema);
    if (typeof zodSchema?.parse !== 'function') {
      throw new Error('Conversion did not produce a valid Zod schema.');
    }
    return zodSchema as unknown as z.ZodObject;
  } catch (err: unknown) {
    console.error(`Failed to generate Zod schema for '${toolName}':`, err);
    return z.object({}).passthrough();
  }
}
