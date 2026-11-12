import { sha256Hex } from '@frontmcp/utils';

import type { SkillEntry } from '../../common';

/** A digest of the skills a document lists, so the document is never served for another set of skills. */
function catalogDigest(skills: readonly SkillEntry[]): string {
  return sha256Hex(JSON.stringify(skills.map((skill) => skill.fullName || skill.name).sort()));
}

/** `body`, made from `skills`, as the cache keeps it: prefixed with the digest of those skills. */
export function toCachedDocument(body: string, skills: readonly SkillEntry[]): string {
  return `${catalogDigest(skills)}\n${body}`;
}

/** The body of a cached document made from exactly `skills`; null for one made from other skills, or none. */
export function fromCachedDocument(cached: string | null, skills: readonly SkillEntry[]): string | null {
  const prefix = `${catalogDigest(skills)}\n`;
  return cached?.startsWith(prefix) ? cached.slice(prefix.length) : null;
}
