/**
 * Task ID generation — cryptographically secure per MCP spec §Security.
 *
 * Uses `randomUUID()` from `@frontmcp/utils` for cross-platform (Node/browser)
 * consistency, as required by `CLAUDE.md` "Crypto Utilities".
 *
 * @module task/helpers/task-id
 */

import { randomUUID } from '@frontmcp/utils';

export function generateTaskId(): string {
  return randomUUID();
}
