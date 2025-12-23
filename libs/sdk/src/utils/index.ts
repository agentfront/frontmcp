// file: libs/sdk/src/utils/index.ts
// Centralized exports for SDK utilities

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

// Token utilities
export { tokenName, isClass, isPromise, depsOfClass, depsOfFunc } from './token.utils';

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

// Metadata utilities
export { getMetadata, setMetadata, hasAsyncWith } from './metadata.utils';

// Platform-agnostic crypto utilities (Web Crypto API)
export { generateUUID, getRandomBytes, getRandomHex, sha256, sha256Sync, simpleHash } from './platform-crypto';
