// file: libs/sdk/src/skill/sep-2640/sep-2640.last-modified.ts

/**
 * Resolve `annotations.lastModified` for a skill resource per SEP-2640
 * §Resource Metadata + skill-meta-keys.md.
 *
 * For file-backed skills we use the SKILL.md file's mtime. Inline /
 * URL-sourced skills carry no filesystem timestamp; we omit
 * `lastModified` for them rather than make one up — clients fall back to
 * content-hashing or skip caching.
 */

import { stat } from '@frontmcp/utils';

import { SkillKind, type SkillEntry } from '../../common';

/**
 * Best-effort `lastModified` resolver. Returns an ISO 8601 timestamp
 * string when the skill is file-backed and the file is reachable; returns
 * `undefined` otherwise (caller MUST treat absence as "unknown", not
 * "never modified").
 */
export async function resolveLastModifiedForSkill(skill: SkillEntry): Promise<string | undefined> {
  const record = (skill as unknown as { record?: { kind?: string; filePath?: string } }).record;
  if (!record || record.kind !== SkillKind.FILE || !record.filePath) {
    return undefined;
  }

  try {
    const s = await stat(record.filePath);
    // mtime is a Date; toISOString() yields ISO 8601 in UTC.
    return s.mtime instanceof Date ? s.mtime.toISOString() : undefined;
  } catch {
    return undefined;
  }
}
