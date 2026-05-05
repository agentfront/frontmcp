// file: libs/sdk/src/skill/sep-2640/sep-2640.builders.ts

/**
 * Builders for SEP-2640 conformant payloads:
 * - `skill://index.json` document construction
 * - Raw `SKILL.md` serialisation (frontmatter + body) so MCP-served skill
 *   content equals the filesystem form, per the "Hosts: Unified Treatment"
 *   guidance in the SEP.
 */

import * as yaml from 'js-yaml';

import type { SkillContent } from '../../common/interfaces';
import type { SkillMetadata } from '../../common/metadata';
import { SKILL_INDEX_SCHEMA_URI, type SkillIndexDocument, type SkillIndexEntry } from './sep-2640.constants';
import { buildSkillUri } from './sep-2640.uri';

/**
 * Input for building an index entry from a registered skill.
 */
export interface IndexEntryInput {
  name: string;
  description: string;
  /**
   * Multi-segment skill path. The final segment MUST equal `name`. Defaults
   * to `[name]` for flat skills.
   */
  skillPathSegments?: string[];
}

/**
 * Build a single `type: "skill-md"` entry. The `url` is always
 * `skill://<skill-path>/SKILL.md`.
 */
export function buildSkillMdIndexEntry(input: IndexEntryInput): SkillIndexEntry {
  const segments = input.skillPathSegments ?? [input.name];
  return {
    type: 'skill-md',
    name: input.name,
    description: input.description,
    url: buildSkillUri(segments, 'SKILL.md'),
  };
}

/**
 * Build a `type: "mcp-resource-template"` entry for a parameterised skill
 * namespace. Per SEP-2640, the `url` is an RFC 6570 URI template that
 * resolves to `SKILL.md` resource URIs.
 */
export function buildResourceTemplateIndexEntry(description: string, uriTemplate: string): SkillIndexEntry {
  return {
    type: 'mcp-resource-template',
    description,
    url: uriTemplate,
  };
}

/**
 * Build a `type: "archive"` entry. The `url` is the resource URI of the
 * packed archive (`application/zip` or `application/x-tar`).
 */
export function buildArchiveIndexEntry(description: string, archiveUri: string, name?: string): SkillIndexEntry {
  const entry: SkillIndexEntry = {
    type: 'archive',
    description,
    url: archiveUri,
  };
  if (name) entry.name = name;
  return entry;
}

/**
 * Wrap a list of entries in the SEP-2640 index document shape.
 */
export function buildSkillIndex(entries: SkillIndexEntry[]): SkillIndexDocument {
  return {
    $schema: SKILL_INDEX_SCHEMA_URI,
    skills: entries,
  };
}

/**
 * Frontmatter fields preserved when serialising back to SKILL.md.
 * Order is intentional: matches the agentskills.io spec field order so
 * round-tripped files look natural.
 */
type SerializableFrontmatter = Record<string, unknown>;

function buildFrontmatter(skill: SkillContent): SerializableFrontmatter {
  const fm: SerializableFrontmatter = {
    name: skill.name,
    description: skill.description,
  };
  if (skill.license) fm['license'] = skill.license;
  if (skill.compatibility) fm['compatibility'] = skill.compatibility;
  if (skill.allowedTools) fm['allowed-tools'] = skill.allowedTools;
  if (skill.specMetadata && Object.keys(skill.specMetadata).length > 0) {
    fm['metadata'] = skill.specMetadata;
  }
  if (skill.tools && skill.tools.length > 0) {
    fm['tools'] = skill.tools.map((t) => {
      if (!t.purpose && !t.required) return t.name;
      const entry: Record<string, unknown> = { name: t.name };
      if (t.purpose) entry['purpose'] = t.purpose;
      if (t.required) entry['required'] = t.required;
      return entry;
    });
  }
  if (skill.parameters && skill.parameters.length > 0) {
    fm['parameters'] = skill.parameters;
  }
  if (skill.examples && skill.examples.length > 0) {
    fm['examples'] = skill.examples;
  }
  return fm;
}

/**
 * Serialise a SkillContent back to SKILL.md form (YAML frontmatter + body).
 *
 * This is what `resources/read` returns for `skill://<name>/SKILL.md` so
 * hosts can parse the result identically to a filesystem skill — fulfilling
 * SEP-2640's "Unified Treatment of Filesystem and MCP Skills" guidance.
 *
 * Note: instructions may contain references / examples tables that the
 * SDK auto-appends when loading; for the SEP route we restore the *raw*
 * body. Callers that already have raw instructions (e.g. parsed from a
 * SKILL.md file) should pass `rawInstructions` to bypass any reconstructed
 * content.
 */
export function serializeSkillMd(skill: SkillContent, rawInstructions?: string): string {
  const fm = buildFrontmatter(skill);
  const yamlBlock = yaml
    .dump(fm, {
      lineWidth: -1, // don't wrap long lines (descriptions, allowed-tools)
      noRefs: true,
      sortKeys: false,
    })
    .trimEnd();

  const body = (rawInstructions ?? skill.instructions).trimEnd();
  return `---\n${yamlBlock}\n---\n\n${body}\n`;
}

/**
 * Synthesize a SkillContent from raw SkillMetadata for cases where the
 * index needs metadata-only access (no instructions loaded yet).
 */
export function metadataToContentStub(metadata: SkillMetadata): IndexEntryInput {
  return {
    name: metadata.name,
    description: metadata.description,
  };
}
