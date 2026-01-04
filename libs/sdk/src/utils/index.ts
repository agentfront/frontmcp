// file: libs/sdk/src/utils/index.ts
// SDK-specific utilities only - no re-exports

// MCP-specific naming utilities (use MCP_ALLOWED character set)
export { normalizeSegment, normalizeProviderId, normalizeOwnerPath } from './naming.utils';

// Owner lineage and qualified name utilities (SDK-specific types)
export {
  ownerKeyOf,
  qualifiedNameOf,
  parseQualifiedName,
  lineageDepth,
  lineagesEqual,
  isAncestorLineage,
} from './lineage.utils';

// MCP-specific content utilities
export { toStructuredContent, TextContent, BlobContent, ResourceContent, buildResourceContent } from './content.utils';
