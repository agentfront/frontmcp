import type { McpOpenAPITool } from 'mcp-from-openapi';

import type { JSONSchema } from '@frontmcp/lazy-zod';

type JsonSchema = JSONSchema.JSONSchema;

/** 204 No Content and 205 Reset Content answer without a body. */
const BODYLESS_STATUS_CODES = new Set([204, 205]);

/** The `x-status-code` the generator gives a `default` response, and a `2XX` one. */
const DEFAULT_RESPONSE_STATUS = 0;
const SUCCESS_RANGE_STATUS = 2;

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
 * (a description and no `content`), which the generator types `null`. 204, 205 and HEAD stay bodyless. The
 * generator's union of status codes becomes an `anyOf`, since an answer may fit more than one status.
 */
export function outputSchemaOf(tool: McpOpenAPITool): JsonSchema | undefined {
  const outputSchema = tool.outputSchema;
  if (!outputSchema || tool.metadata.method === 'head') return outputSchema;
  const statusBranches = outputSchema.oneOf;
  if (statusBranches && outputSchema['x-status-code'] === undefined) {
    const { oneOf: _exclusive, ...union } = outputSchema;
    return { ...union, anyOf: statusBranches.map(acceptAnyUndeclaredBody) };
  }
  return acceptAnyUndeclaredBody(outputSchema);
}
