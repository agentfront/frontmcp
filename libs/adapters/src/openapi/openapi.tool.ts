import { z } from 'zod';
import { tool, FrontMcpLogger } from '@frontmcp/sdk';
import { convertJsonSchemaToZod } from 'zod-from-json-schema';
import type { McpOpenAPITool } from 'mcp-from-openapi';
import type {
  OpenApiAdapterOptions,
  InputTransformContext,
  ExtendedToolMetadata,
  InputTransform,
} from './openapi.types';
import type { JSONSchema } from 'zod/v4/core';

/** JSON Schema type from Zod v4 */
type JsonSchema = JSONSchema.JSONSchema;
import { buildRequest, applyAdditionalHeaders, parseResponse } from './openapi.utils';
import { resolveToolSecurity } from './openapi.security';
import { validateFrontMcpExtension, type ValidatedFrontMcpExtension } from './openapi.frontmcp-schema';

/**
 * Create a FrontMCP tool from an OpenAPI tool definition
 *
 * @param openapiTool - OpenAPI tool with mapper
 * @param options - Adapter options
 * @param logger - Logger instance
 * @returns FrontMCP tool
 */
export function createOpenApiTool(openapiTool: McpOpenAPITool, options: OpenApiAdapterOptions, logger: FrontMcpLogger) {
  // Cast metadata to extended type (includes adapter-added fields)
  const metadata = openapiTool.metadata as ExtendedToolMetadata;

  // Get transforms stored in metadata by adapter
  const inputTransforms = metadata.adapter?.inputTransforms ?? [];
  const toolTransform = metadata.adapter?.toolTransform ?? {};

  // Validate and parse x-frontmcp extension from OpenAPI spec
  const frontmcpValidation = validateFrontMcpExtension(metadata.frontmcp, openapiTool.name, logger);
  const frontmcpExt: ValidatedFrontMcpExtension | null = frontmcpValidation.data;

  // Convert JSON Schema to Zod schema for input validation
  const schemaResult = getZodSchemaFromJsonSchema(openapiTool.inputSchema, openapiTool.name, logger);

  // Build tool metadata with transforms applied
  // Priority: OpenAPI x-frontmcp → toolTransforms (adapter can override spec)
  const toolMetadata: Record<string, unknown> = {
    id: openapiTool.name,
    name: openapiTool.name,
    description: openapiTool.description,
    inputSchema: schemaResult.schema.shape || {},
    rawInputSchema: openapiTool.inputSchema,
  };

  // Track schema conversion failure in metadata for debugging
  if (schemaResult.conversionFailed) {
    toolMetadata['_schemaConversionFailed'] = true;
    toolMetadata['_schemaConversionError'] = schemaResult.error;
  }

  // 1. Apply validated x-frontmcp extensions from OpenAPI spec (base layer)
  if (frontmcpExt) {
    if (frontmcpExt.annotations) {
      toolMetadata['annotations'] = { ...frontmcpExt.annotations };
    }
    if (frontmcpExt.tags) {
      toolMetadata['tags'] = [...frontmcpExt.tags];
    }
    if (frontmcpExt.hideFromDiscovery !== undefined) {
      toolMetadata['hideFromDiscovery'] = frontmcpExt.hideFromDiscovery;
    }
    if (frontmcpExt.examples) {
      toolMetadata['examples'] = [...frontmcpExt.examples];
    }
    if (frontmcpExt.cache) {
      toolMetadata['cache'] = { ...frontmcpExt.cache };
    }
    if (frontmcpExt.codecall) {
      toolMetadata['codecall'] = { ...frontmcpExt.codecall };
    }
  }

  // 2. Apply toolTransforms (adapter-level overrides)
  if (toolTransform.annotations) {
    toolMetadata['annotations'] = {
      ...((toolMetadata['annotations'] as object) || {}),
      ...toolTransform.annotations,
    };
  }
  if (toolTransform.tags) {
    const existingTags = (toolMetadata['tags'] as string[]) || [];
    toolMetadata['tags'] = [...existingTags, ...toolTransform.tags];
  }
  if (toolTransform.hideFromDiscovery !== undefined) {
    toolMetadata['hideFromDiscovery'] = toolTransform.hideFromDiscovery;
  }
  if (toolTransform.examples) {
    const existingExamples = (toolMetadata['examples'] as unknown[]) || [];
    toolMetadata['examples'] = [...existingExamples, ...toolTransform.examples];
  }
  if (toolTransform.ui) {
    toolMetadata['ui'] = toolTransform.ui;
  }

  return tool(toolMetadata as unknown as Parameters<typeof tool>[0])(async (input, ctx) => {
    // Get auth info using the SDK's unified method (prefers requestContext when available)
    const authInfo = ctx.getAuthInfo();

    // 1. Inject transformed values (from inputTransforms)
    const transformContext: InputTransformContext = {
      authInfo,
      env: process.env,
      tool: openapiTool,
    };
    const injectedInput = await injectTransformedValues(
      input as Record<string, unknown>,
      inputTransforms,
      transformContext,
    );

    // 2. Resolve security from context
    const security = await resolveToolSecurity(openapiTool, authInfo, options);

    // 3. Build request from mapper (now uses injectedInput)
    const { url, headers, body: requestBody } = buildRequest(openapiTool, injectedInput, security, options.baseUrl);

    // 4. Apply additional headers
    applyAdditionalHeaders(headers, options.additionalHeaders);

    // 5. Apply custom headers mapper with error handling
    if (options.headersMapper) {
      try {
        const mappedHeaders = options.headersMapper(authInfo, headers);
        if (mappedHeaders && typeof mappedHeaders.forEach === 'function') {
          mappedHeaders.forEach((value, key) => {
            headers.set(key, value);
          });
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        throw new Error(`headersMapper failed for tool '${openapiTool.name}': ${errorMessage}`);
      }
    }

    // 6. Apply custom body mapper with error handling
    let finalBody = requestBody;
    if (options.bodyMapper && requestBody) {
      try {
        finalBody = options.bodyMapper(authInfo, requestBody);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        throw new Error(`bodyMapper failed for tool '${openapiTool.name}': ${errorMessage}`);
      }
    }

    // 7. Set content-type if we have a body
    if (finalBody && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }

    // 8. Serialize body and check size limit
    let serializedBody: string | undefined;
    if (finalBody) {
      try {
        serializedBody = JSON.stringify(finalBody);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Failed to serialize request body for tool '${openapiTool.name}': ${errorMessage}. ` +
            `Body may contain circular references, BigInt, or non-serializable values.`,
        );
      }
      // Check request body size limit (10MB default)
      const maxRequestSize = options.maxRequestSize ?? DEFAULT_MAX_REQUEST_SIZE;
      if (serializedBody.length > maxRequestSize) {
        throw new Error(
          `Request body size (${serializedBody.length} bytes) exceeds maximum allowed (${maxRequestSize} bytes)`,
        );
      }
    }

    // 9. Execute request with timeout
    const requestTimeout = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), requestTimeout);

    try {
      const response = await fetch(url, {
        method: openapiTool.metadata.method.toUpperCase(),
        headers,
        body: serializedBody,
        signal: controller.signal,
      });

      // 10. Parse and return response
      return await parseResponse(response, { maxResponseSize: options.maxResponseSize });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Request timeout after ${requestTimeout}ms for tool '${openapiTool.name}'`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  });
}

/** Default timeout for transform injection: 5 seconds */
const DEFAULT_TRANSFORM_TIMEOUT_MS = 5000;

/** Default request timeout: 30 seconds */
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

/** Default max request body size: 10MB */
const DEFAULT_MAX_REQUEST_SIZE = 10 * 1024 * 1024;

/** Reserved keys that cannot be used as inputKey (prototype pollution protection) */
const RESERVED_KEYS = ['__proto__', 'constructor', 'prototype'];

/**
 * Safely inject a single transform value with timeout and error handling
 *
 * @param transform - Transform to apply
 * @param ctx - Transform context
 * @param timeoutMs - Timeout in milliseconds
 * @returns Injected value or undefined
 */
async function safeInject(
  transform: InputTransform,
  ctx: InputTransformContext,
  timeoutMs: number = DEFAULT_TRANSFORM_TIMEOUT_MS,
): Promise<unknown> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race([
      Promise.resolve(transform.inject(ctx)),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Transform timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    throw new Error(`Input transform for '${transform.inputKey}' failed: ${errorMessage}`);
  } finally {
    // Always clear the timeout to prevent memory leaks
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Validate that input is a plain object (not null, array, or primitive)
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Inject transformed values into the input object
 */
async function injectTransformedValues(
  input: unknown,
  transforms: InputTransform[],
  ctx: InputTransformContext,
): Promise<Record<string, unknown>> {
  // Validate input is a plain object to prevent prototype pollution
  if (!isPlainObject(input)) {
    throw new Error(`Invalid input type: expected object, got ${input === null ? 'null' : typeof input}`);
  }

  if (transforms.length === 0) return input;

  const result = { ...input };

  for (const transform of transforms) {
    // Prototype pollution protection: reject reserved keys
    if (RESERVED_KEYS.includes(transform.inputKey)) {
      throw new Error(
        `Invalid inputKey '${transform.inputKey}': reserved keys (${RESERVED_KEYS.join(', ')}) cannot be used`,
      );
    }

    const value = await safeInject(transform, ctx);
    if (value !== undefined) {
      result[transform.inputKey] = value;
    }
  }

  return result;
}

/**
 * Result of schema conversion with success indicator
 */
interface SchemaConversionResult {
  schema: z.ZodObject;
  conversionFailed: boolean;
  error?: string;
}

/**
 * Converts a JSON Schema to a Zod schema for runtime validation
 *
 * @param jsonSchema - JSON Schema
 * @param toolName - Tool name for error reporting
 * @param logger - Logger instance
 * @returns Schema conversion result with success indicator
 */
function getZodSchemaFromJsonSchema(
  jsonSchema: JsonSchema,
  toolName: string,
  logger: FrontMcpLogger,
): SchemaConversionResult {
  if (typeof jsonSchema !== 'object' || jsonSchema === null) {
    logger.warn(`[${toolName}] No valid JSON schema provided, using permissive schema`);
    return { schema: z.looseObject({}), conversionFailed: true, error: 'No valid JSON schema' };
  }

  try {
    const zodSchema = convertJsonSchemaToZod(jsonSchema);
    if (typeof zodSchema?.parse !== 'function') {
      throw new Error('Conversion did not produce a valid Zod schema.');
    }
    return { schema: zodSchema as unknown as z.ZodObject, conversionFailed: false };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.warn(
      `[${toolName}] Failed to generate Zod schema, using permissive schema. ` +
        `Tool will accept any input but may fail at API level. Error: ${errorMessage}`,
    );
    return { schema: z.looseObject({}), conversionFailed: true, error: errorMessage };
  }
}
