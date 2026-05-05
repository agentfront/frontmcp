// file: libs/sdk/src/skill/sep-2640/sep-2640.constants.ts

/**
 * Constants for MCP SEP-2640 (Skills Extension) conformance.
 *
 * SEP-2640 defines a convention for serving Agent Skills over MCP using the
 * existing Resources primitive under the `skill://` URI scheme. The extension
 * adds no new protocol methods — only a capability declaration and URI shape.
 *
 * @see https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2640
 * @see https://github.com/modelcontextprotocol/experimental-ext-skills
 */

/**
 * The extension identifier as declared in the server `initialize` response
 * under `capabilities.extensions[<id>]`.
 */
export const SEP_2640_EXTENSION_ID = 'io.modelcontextprotocol/skills' as const;

/**
 * Reverse-DNS namespace prefix for `_meta` keys on skill resources.
 * Per skill-meta-keys.md, MCP-transport-specific metadata SHOULD use this
 * prefix; skill-level semantics belong in frontmatter, not `_meta`.
 */
export const SEP_2640_META_NAMESPACE = 'io.modelcontextprotocol.skills/' as const;

/**
 * Singular `skill://` URI scheme used by SEP-2640 and four converged
 * implementations (FastMCP 3.0, NimbleBrain, skilljack-mcp, skillsdotnet).
 *
 * This is the only URI scheme FrontMCP serves skills under — there is no
 * back-compat plural `skills://` scheme.
 */
export const SKILL_URI_SCHEME = 'skill://' as const;

/**
 * Well-known URI for the skill discovery index, modelled after the
 * Agent Skills `/.well-known/agent-skills/index.json` shape.
 */
export const SKILL_INDEX_URI = 'skill://index.json' as const;

/**
 * Schema URI for the index document, matching the agentskills.io
 * discovery RFC v0.2.0. Clients SHOULD verify this before parsing.
 */
export const SKILL_INDEX_SCHEMA_URI = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json' as const;

/**
 * Index entry types per SEP-2640 §Discovery.
 */
export type SkillIndexEntryType = 'skill-md' | 'mcp-resource-template' | 'archive';

/**
 * SEP-2640 index entry. Mirrors the agentskills.io well-known index
 * format with two adjustments: `url` is a full MCP resource URI (any
 * scheme the server serves), and `digest` is omitted (transport handles
 * integrity over an authenticated MCP connection).
 */
export interface SkillIndexEntry {
  /** Type of entry. */
  type: SkillIndexEntryType;
  /** Skill name — required for `skill-md`, omitted for `mcp-resource-template`. */
  name?: string;
  /** Description of the skill or addressable space. */
  description: string;
  /**
   * For `skill-md`: full resource URI of the skill's `SKILL.md`.
   * For `mcp-resource-template`: an RFC 6570 URI template.
   * For `archive`: full resource URI of the archive resource.
   */
  url: string;
}

/**
 * SEP-2640 index document shape.
 */
export interface SkillIndexDocument {
  $schema: typeof SKILL_INDEX_SCHEMA_URI;
  skills: SkillIndexEntry[];
}

/**
 * Recommended MIME type for a `SKILL.md` resource.
 */
export const SKILL_MD_MIME_TYPE = 'text/markdown' as const;

/**
 * Recommended MIME type for the index resource.
 */
export const SKILL_INDEX_MIME_TYPE = 'application/json' as const;

/**
 * MIME types acceptable for archive distribution per SEP-2640 ADR
 * 2026-04-19 (Archive Distribution).
 */
export const SKILL_ARCHIVE_MIME_TYPES = ['application/zip', 'application/x-tar'] as const;

/**
 * Recommended `annotations.priority` for the primary `SKILL.md` resource.
 * Hosts use this to decide what to load first under progressive disclosure.
 */
export const SKILL_MD_PRIORITY = 0.8 as const;

/**
 * Recommended `annotations.priority` for supporting reference / example /
 * script files.
 */
export const SKILL_SUPPORT_PRIORITY = 0.3 as const;
