/**
 * Follow MCP list pagination (`cursor` / `nextCursor`) to the end.
 *
 * A FrontMCP server pages `tools/list`, `resources/list`,
 * `resources/templates/list` and `prompts/list` (40 items per page by default),
 * so a client that reads only the first response silently misses the rest.
 */
import { InternalMcpError } from '../../errors/mcp.error';

/** Most pages one listing follows before giving up on a server that never stops paging. */
export const MAX_LIST_PAGES = 1000;

/**
 * Fetch pages until one comes back without a `nextCursor`, concatenating their items.
 *
 * Throws when the server hands back a cursor it already returned (its
 * pagination does not advance) or pages past {@link MAX_LIST_PAGES}.
 *
 * @param method - The list method, for error messages (e.g. `'tools/list'`)
 * @param fetchPage - Fetches one page; `cursor` is `undefined` for the first
 * @param fail - Builds the error thrown for a stalled listing (default {@link InternalMcpError})
 */
export async function listAllPages<TItem>(
  method: string,
  fetchPage: (cursor: string | undefined) => Promise<{ items: TItem[] | undefined; nextCursor?: string }>,
  fail: (message: string) => Error = (message) => new InternalMcpError(message, 'LIST_PAGINATION_STALLED'),
): Promise<TItem[]> {
  const items: TItem[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const result = await fetchPage(cursor);
    items.push(...(result.items ?? []));

    const next = result.nextCursor;
    if (!next) return items;
    if (seenCursors.has(next)) {
      throw fail(`${method} returned the cursor "${next}" twice`);
    }
    seenCursors.add(next);
    cursor = next;
  }

  throw fail(`${method} did not finish within ${MAX_LIST_PAGES} pages`);
}
