import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { jsonBytes } from './folded-answer';
import { foldingStoresOf, resultOwnerOf } from './result-handle.store';
import { ResultHandleNotFoundError, ResultSliceTooLargeError } from './result-handles.errors';
import { ResultHandlesConfigToken, ResultHandleStoreToken } from './result-handles.symbols';
import { DEFAULT_CHAR_LIMIT, DEFAULT_ITEM_LIMIT, queryResult, type ResultSlice } from './result-query';

export const RESULT_QUERY_TOOL_NAME = 'result_query';

const MAX_LIMIT = 100_000;

export const resultQueryInputSchema = {
  handle: z.string().min(1).max(100).describe('The handle of a folded answer'),
  path: z
    .string()
    .max(1000)
    .optional()
    .describe(
      'What to read: a dot path ($.rows[2].title, rows.2.title) or a JSON pointer (/rows/2/title); $ by default',
    ),
  offset: z.number().int().min(0).optional().describe('The first item of a list, or character of a string, to read'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .optional()
    .describe(`How many list items (${DEFAULT_ITEM_LIMIT} by default) or characters (${DEFAULT_CHAR_LIMIT}) to read`),
  page: z
    .number()
    .int()
    .min(1)
    .max(Math.floor(Number.MAX_SAFE_INTEGER / MAX_LIMIT))
    .optional()
    .describe('A page of limit items, from 1, in place of offset'),
  fields: z
    .array(z.string().min(1))
    .max(100)
    .optional()
    .describe('Keep only these keys of the object, or of each object of the list'),
};

export const resultQueryOutputSchema = z.object({
  path: z.string(),
  value: z.unknown(),
  total: z.number().int().optional(),
  offset: z.number().int().optional(),
  nextOffset: z.number().int().optional(),
});

type ResultQueryInput = {
  handle: string;
  path?: string;
  offset?: number;
  limit?: number;
  page?: number;
  fields?: string[];
};

/** Reads slices of an answer the plugin folded, for the session and caller it was folded for. */
@Tool({
  name: RESULT_QUERY_TOOL_NAME,
  description:
    'Read part of a large tool answer that was folded into a preview, a shape and a handle. ' +
    'Give the handle and a path from the shape; read a list by offset and limit or by page, ' +
    'a long string by character offset and limit, and keep only some keys with fields.',
  inputSchema: resultQueryInputSchema,
  outputSchema: resultQueryOutputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true },
})
export default class ResultQueryTool extends ToolContext {
  async execute({ handle, ...query }: ResultQueryInput): Promise<ResultSlice> {
    const owner = resultOwnerOf(this);
    let stored: { value: unknown } | undefined;
    for (const store of new Set([this.get(ResultHandleStoreToken), ...foldingStoresOf(this.scope)])) {
      stored = await store.read(handle, owner);
      if (stored) break;
    }
    if (!stored) throw new ResultHandleNotFoundError();
    const slice = queryResult(stored.value, query);
    const { thresholdBytes } = this.get(ResultHandlesConfigToken);
    const bytes = jsonBytes(slice.value);
    if (bytes > thresholdBytes) throw new ResultSliceTooLargeError(bytes, thresholdBytes);
    return slice;
  }
}
