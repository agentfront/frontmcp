// file: libs/sdk/src/utils/index.ts
// Centralized exports for SDK utilities

// Re-export DI utilities for backwards compatibility
export {
  tokenName,
  isClass,
  isPromise,
  depsOfClass,
  depsOfFunc,
  getAsyncWithTokens,
  readWithParamTypes,
  getMetadata,
  setMetadata,
  hasAsyncWith,
} from '@frontmcp/di';

// Naming and case conversion utilities
export {
  NameCase,
  splitWords,
  toCase,
  sepFor,
  normalizeSegment,
  normalizeProviderId,
  normalizeOwnerPath,
  shortHash,
  ensureMaxLen,
} from './naming.utils';

// Owner lineage and qualified name utilities
export {
  ownerKeyOf,
  qualifiedNameOf,
  parseQualifiedName,
  lineageDepth,
  lineagesEqual,
  isAncestorLineage,
} from './lineage.utils';

// URI validation utilities (RFC 3986)
export { isValidMcpUri, extractUriScheme, isValidMcpUriTemplate } from './uri-validation.utils';

// URI template parsing and matching utilities
export { parseUriTemplate, matchUriTemplate, expandUriTemplate } from './uri-template.utils';

// Content utilities
export {
  sanitizeToJson,
  toStructuredContent,
  TextContent,
  BlobContent,
  ResourceContent,
  buildResourceContent,
  inferMimeType,
} from './content.utils';

// String utilities
export { idFromString } from './string.utils';
