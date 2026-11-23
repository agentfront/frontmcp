import type { McpOpenAPITool } from 'mcp-from-openapi';

import type { JSONSchema } from '@frontmcp/lazy-zod';

type JsonSchema = JSONSchema.JSONSchema;

/** 204 No Content and 205 Reset Content answer without a body. */
const BODYLESS_STATUS_CODES = new Set([204, 205]);

/** The `x-status-code` the generator gives a `default` response, and a `2XX` one. */
const DEFAULT_RESPONSE_STATUS = 0;
const SUCCESS_RANGE_STATUS = '2XX';

function isSuccessWithBody(statusCode: unknown): boolean {
  if (statusCode === DEFAULT_RESPONSE_STATUS || statusCode === SUCCESS_RANGE_STATUS) return true;
  return (
    typeof statusCode === 'number' && statusCode >= 200 && statusCode < 300 && !BODYLESS_STATUS_CODES.has(statusCode)
  );
}

/** A success response the spec documents with a description only: the generator types its body `null`. */
function acceptAnyUndeclaredBody(schema: JsonSchema): JsonSchema {
  const undeclared =
    schema.type === 'null' && schema['x-content-type'] === undefined && isSuccessWithBody(schema['x-status-code']);
  if (!undeclared) return schema;
  const { type: _null, ...annotations } = schema;
  return annotations;
}

/**
 * The tool's output schema, accepting any answer to a success response whose body the spec doesn't describe
 * (a description and no `content`), which the generator types `null`, in each branch of its `anyOf` of status
 * codes too. 204, 205 and HEAD stay bodyless.
 */
export function outputSchemaOf(tool: McpOpenAPITool): JsonSchema | undefined {
  const outputSchema = tool.outputSchema;
  if (!outputSchema || tool.metadata.method === 'head') return outputSchema;
  const statusBranches = outputSchema.anyOf;
  if (statusBranches && outputSchema['x-status-code'] === undefined) {
    return { ...outputSchema, anyOf: statusBranches.map(acceptAnyUndeclaredBody) };
  }
  return acceptAnyUndeclaredBody(outputSchema);
}
