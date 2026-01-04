// file: libs/sdk/src/utils/naming.utils.ts
// MCP-specific naming utilities that use the MCP_ALLOWED character set

import { splitWords, toCase, sepFor, NameCase } from '@frontmcp/utils';

// Allowed chars per MCP spec: a-zA-Z0-9 _ - . /
const MCP_ALLOWED = /[A-Za-z0-9_\-./]/;

/**
 * Normalize a single segment (name part) to MCP-safe characters.
 */
export function normalizeSegment(raw: string, kind: NameCase): string {
  const words = splitWords(raw);
  let cased = toCase(words, kind);
  cased = [...cased].filter((ch) => MCP_ALLOWED.test(ch)).join('');
  return cased || 'x';
}

/**
 * Normalize a provider ID to MCP-safe characters.
 */
export function normalizeProviderId(raw: string | undefined, kind: NameCase): string | undefined {
  if (!raw) return undefined;
  const tokens = raw.split(/\W+/);
  const cased = toCase(tokens, kind);
  const safe = [...cased].filter((ch) => MCP_ALLOWED.test(ch)).join('');
  return safe || undefined;
}

/**
 * Normalize an owner path (app:id/plugin:id) to the specified naming case.
 */
export function normalizeOwnerPath(ownerKey: string, kind: NameCase): string {
  const levels = ownerKey.split('/');
  const normLevels = levels.map((level) => {
    const parts = level.split(':'); // ["app","Portal"]
    return parts.map((p) => normalizeSegment(p, kind)).join(sepFor(kind));
  });
  if (kind === 'camel') return normLevels.map((seg) => seg.charAt(0).toLowerCase() + seg.slice(1)).join('');
  return normLevels.join(sepFor(kind));
}
