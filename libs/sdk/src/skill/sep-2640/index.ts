// file: libs/sdk/src/skill/sep-2640/index.ts

/**
 * SEP-2640 (Skills Extension) conformance helpers.
 *
 * This module implements the convention defined by MCP SEP-2640 for serving
 * Agent Skills over MCP using the Resources primitive and the singular
 * `skill://` URI scheme — the only URI scheme FrontMCP serves skills under.
 *
 * @module skill/sep-2640
 */

export {
  SEP_2640_EXTENSION_ID,
  SEP_2640_META_NAMESPACE,
  SKILL_ARCHIVE_MIME_TYPES,
  SKILL_INDEX_MIME_TYPE,
  SKILL_INDEX_SCHEMA_URI,
  SKILL_INDEX_URI,
  SKILL_MD_MIME_TYPE,
  SKILL_MD_PRIORITY,
  SKILL_SUPPORT_PRIORITY,
  SKILL_URI_SCHEME,
  type SkillIndexDocument,
  type SkillIndexEntry,
  type SkillIndexEntryType,
} from './sep-2640.constants';

export {
  buildSkillUri,
  isSkillIndexUri,
  isSkillUri,
  parseSkillUri,
  parseSkillUriWithKnownSkill,
  validateSkillPath,
  type ParsedSkillUri,
} from './sep-2640.uri';

export {
  buildArchiveIndexEntry,
  buildResourceTemplateIndexEntry,
  buildSkillIndex,
  buildSkillMdIndexEntry,
  metadataToContentStub,
  serializeSkillMd,
  type IndexEntryInput,
} from './sep-2640.builders';
